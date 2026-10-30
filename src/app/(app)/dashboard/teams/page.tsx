import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { findNavItem } from "@/config/navigation";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { flattenParams, withParams } from "@/features/leads/url";
import { DailyReportForm } from "@/features/teams/components/daily-report-form";
import { DateParam, SegmentParam, TeamSelect } from "@/features/teams/components/param-controls";
import { RosterDayForm } from "@/features/teams/components/roster-form";
import { MyRosterList, RosterMonthGrid } from "@/features/teams/components/roster-views";
import { TeamsPanel } from "@/features/teams/components/teams-panel";
import { formatListedOn } from "@/features/inventory/format";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { businessToday } from "@/modules/bookings/today";
import { canManageTeams, canViewOwnRoster, canViewTeam, canViewTeams } from "@/modules/teams/policy";
import { getDailyReport, getRosterDay, getRosterMonth, listDailyReports, myRoster, teamDetail, teamFormOptions, teamTiles, visibleTeams } from "@/modules/teams/queries";
import { requirePageUser } from "@/server/auth/current-user";
import type { Actor } from "@/server/auth/types";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Teams" };

const TABS = [
  { key: "teams", label: "Teams" },
  { key: "daily", label: "Daily Report" },
  { key: "roster", label: "Duty Roster" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const isDate = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
const isMonth = (v?: string) => Boolean(v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v));

function TabBar({ active, params }: { active: Tab; params: Record<string, string> }) {
  return (
    <nav
      aria-label="Teams views"
      className="flex gap-1.5 overflow-x-auto rounded-2xl border border-zinc-200/80 bg-white p-1.5 shadow-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={withParams("/dashboard/teams", params, { tab: t.key })}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "flex shrink-0 items-center rounded-xl px-3.5 py-2 text-xs leading-4 font-bold whitespace-nowrap transition-colors",
            t.key === active ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-zinc-100",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

async function TeamsTab({ actor, params }: { actor: Actor; params: Record<string, string> }) {
  const db = getDb();
  const teams = await visibleTeams(db, actor);
  const selected = teams.find((t) => t.id === params.team)?.id ?? null;
  const [detail, options] = await Promise.all([
    selected ? teamDetail(db, actor, selected) : Promise.resolve(null),
    canManageTeams(actor) ? teamFormOptions(db, actor) : Promise.resolve({ managers: [], candidates: [] }),
  ]);
  return (
    <TeamsPanel
      key={selected ?? "none"}
      teams={teams}
      detail={detail ? { team: detail.team, members: detail.members, history: detail.history } : null}
      canManage={canManageTeams(actor)}
      managers={options.managers}
      candidates={options.candidates}
      params={params}
    />
  );
}

async function DailyTab({ actor, params }: { actor: Actor; params: Record<string, string> }) {
  const db = getDb();
  const today = businessToday();
  const date = isDate(params.date) ? params.date : today;
  const teams = await visibleTeams(db, actor);
  const team = teams.find((t) => t.id === params.team);
  const [report, list] = await Promise.all([
    team ? getDailyReport(db, actor, team.id, date) : Promise.resolve(null),
    listDailyReports(db, actor, { from: params.from, to: params.to, team: params.listTeam }),
  ]);
  return (
    <div className="space-y-6">
      <PanelCard title="Daily report">
        <p className="-mt-1 mb-4 text-[11px] text-zinc-500">
          Managers enter Leads, Calls, Meetings, Tokens, Bookings, and Remarks for each agent. Admins can review submissions date-wise below.
        </p>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TeamSelect params={params} teams={teams} />
          <DateParam params={params} name="date" label="Report date" value={date} />
        </div>
        <h4 className="mb-2 text-xs font-black">Agent entries</h4>
        {report ? (
          <DailyReportForm key={`${report.team.id}-${date}`} teamId={report.team.id} date={date} rows={report.rows} canEdit={report.canEdit} lockedReason={report.lockedReason} submitted={report.submitted} />
        ) : (
          <EmptyState size="sm">Select a team to enter today&apos;s report.</EmptyState>
        )}
      </PanelCard>
      <PanelCard title="Date-wise submissions">
        <p className="-mt-1 mb-4 text-[11px] text-zinc-500">Admins see all teams; managers see their own. Click a row to open that day.</p>
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <DateParam params={params} name="from" label="From" value={list.from} />
          <DateParam params={params} name="to" label="To" value={list.to} />
          <TeamSelect params={params} teams={teams} label="Team filter" name="listTeam" emptyLabel="All teams" />
        </div>
        <p className="mb-2 text-[11px] font-semibold text-zinc-500">
          Showing {list.from} → {list.to}
        </p>
        {list.rows.length === 0 ? (
          <EmptyState size="sm">No submissions in this range.</EmptyState>
        ) : (
          <div className="overflow-auto rounded-xl border border-zinc-200/80">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead className="bg-zinc-100">
                <tr className="text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  {["Date", "Team", "Agents", "Leads", "Calls", "Meetings", "Tokens", "Bookings", "Submitted by"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2.5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                    <td className="px-3 py-2 font-bold whitespace-nowrap">
                      <Link href={withParams("/dashboard/teams", params, { tab: "daily", team: r.teamId, date: r.date })} className="text-brand hover:underline">
                        {formatListedOn(r.date)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.teamName}</td>
                    {[r.agents, r.leads, r.calls, r.meetings, r.tokens, r.bookings].map((n, i) => (
                      <td key={i} className="px-3 py-2 tabular-nums">
                        {formatInt(n)}
                      </td>
                    ))}
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-600">
                      {r.submittedBy ?? "—"} · {formatDateTime(r.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>
    </div>
  );
}

async function RosterTab({ actor, params }: { actor: Actor; params: Record<string, string> }) {
  const db = getDb();
  const today = businessToday();
  const month = isMonth(params.month) ? params.month : today.slice(0, 7);
  if (!canViewTeams(actor)) {
    const mine = await myRoster(db, actor, month);
    return (
      <PanelCard title="My duty roster">
        <div className="mb-4 max-w-xs">
          <DateParam params={params} name="month" label="Month" type="month" value={month} />
        </div>
        <MyRosterList entries={mine.entries} counts={mine.counts} />
      </PanelCard>
    );
  }
  const view = params.view === "month" ? "month" : "day";
  const date = isDate(params.date) ? params.date : today;
  const teams = await visibleTeams(db, actor);
  const team = teams.find((t) => t.id === params.team);
  const day = team && view === "day" ? await getRosterDay(db, actor, team.id, date) : null;
  const monthGrid = team && view === "month" ? await getRosterMonth(db, actor, team.id, month) : null;
  return (
    <PanelCard title="Duty calendar">
      <p className="-mt-1 text-sm font-black">Who is on, who is off</p>
      <p className="mb-4 text-[11px] text-zinc-500">Mark duty for the team. Leads off days are excluded from Avg M / Avg QC.</p>
      <div className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
        <TeamSelect params={params} teams={teams} />
        <SegmentParam params={params} name="view" label="View" value={view} options={[{ value: "day", label: "Day" }, { value: "month", label: "Month" }]} />
        {view === "day" ? <DateParam params={params} name="date" label="Date" value={date} /> : <DateParam params={params} name="month" label="Month" type="month" value={month} />}
      </div>
      {!team ? (
        <EmptyState size="sm">Select a team to edit the roster.</EmptyState>
      ) : day ? (
        <RosterDayForm key={`${day.team.id}-${date}`} teamId={day.team.id} date={date} rows={day.rows} canEdit={day.canEdit} locked={day.locked} />
      ) : monthGrid ? (
        <RosterMonthGrid days={monthGrid.days} rows={monthGrid.rows} />
      ) : null}
      <p className="mt-4 text-[11px] text-zinc-500">Duty is recorded only; it does not change lead rotation yet (pending client confirmation).</p>
    </PanelCard>
  );
}

export default async function TeamsPage({ searchParams }: PageProps<"/dashboard/teams">) {
  const actor = await requirePageUser();
  const item = findNavItem("/dashboard/teams")!;
  const params = flattenParams(await searchParams);
  const viewer = canViewTeams(actor);
  if (!viewer && !canViewOwnRoster(actor)) return <RestrictedState />;
  const tab: Tab = TABS.some((t) => t.key === params.tab) ? (params.tab as Tab) : viewer ? "teams" : "roster";
  const tiles = viewer ? await teamTiles(getDb(), actor) : null;
  // A team id in the URL that the actor may not see is ignored rather than shown.
  if (params.team && viewer && !canViewTeam(actor, params.team)) delete params.team;

  return (
    <PageStack>
      <PageHeader title="Sales Teams" description={item.description} icon={item.icon} />
      {tiles ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MiniStat label="Teams" value={formatInt(tiles.teams)} caption="In directory" />
          <MiniStat label="Active" value={formatInt(tiles.active)} caption="Assignable" />
          <MiniStat label="Inactive" value={formatInt(tiles.inactive)} caption="Hidden from assignment" />
          <MiniStat label="Members" value={formatInt(tiles.members)} caption="Across all teams" />
        </div>
      ) : null}
      <TabBar active={tab} params={params} />
      {tab === "roster" ? (
        <RosterTab actor={actor} params={params} />
      ) : !viewer ? (
        <RestrictedState />
      ) : tab === "daily" ? (
        <DailyTab actor={actor} params={params} />
      ) : (
        <TeamsTab actor={actor} params={params} />
      )}
    </PageStack>
  );
}
