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
import { CardFilter } from "@/features/leave/components/card-filter";
import { formatListedOn } from "@/features/inventory/format";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { businessToday } from "@/modules/bookings/today";
import { addDays } from "@/modules/teams/dates";
import { canManageTeams, canViewOwnRoster, canViewTeam, canViewTeams } from "@/modules/teams/policy";
import { findVisibleTeamId, getDailyReport, getRosterDay, getRosterMonth, listDailyReports, listTeams, myRoster, teamDetail, teamFormOptions, teamTiles, visibleTeams } from "@/modules/teams/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { agentScores } from "@/modules/leads/assignment";
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

/** ← Previous day · Today · Next day → under a date box (15 Nov 2026). */
function DayStepper({ params, date, today }: { params: Record<string, string>; date: string; today: string }) {
  const link = "rounded-lg border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-50";
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      <Link href={withParams("/dashboard/teams", params, { date: addDays(date, -1) })} className={link}>
        ← Previous day
      </Link>
      {date !== today ? (
        <Link href={withParams("/dashboard/teams", params, { date: today })} className={link}>
          Today
        </Link>
      ) : null}
      <Link href={withParams("/dashboard/teams", params, { date: addDays(date, 1) })} className={link}>
        Next day →
      </Link>
    </div>
  );
}

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
  const [list, selected] = await Promise.all([listTeams(db, actor, params), findVisibleTeamId(db, actor, params.team)]);
  const [detail, options] = await Promise.all([
    selected ? teamDetail(db, actor, selected) : Promise.resolve(null),
    canManageTeams(actor) ? teamFormOptions(db, actor) : Promise.resolve({ managers: [], candidates: [] }),
  ]);
  const allScoreRows = detail ? detail.members.filter((m) => m.role === "agent" && m.status === "active") : [];
  const scores = await agentScores(db, allScoreRows.map((m) => m.id));
  // Search and filter the scores (15 Nov 2026): by name, provisional, or low score.
  const sq = (params.sq ?? "").trim().toLowerCase();
  const scoreRows = allScoreRows
    .filter((m) => !sq || m.name.toLowerCase().includes(sq))
    .filter((m) => {
      const s = scores.get(m.id)!;
      return params.sshow === "provisional" ? s.provisional : params.sshow === "low" ? s.score < 50 : params.sshow === "settled" ? !s.provisional : true;
    });
  return (
    <>
    <TeamsPanel
      key={selected ?? "none"}
      list={list}
      detail={detail ? { team: detail.team, members: detail.members, history: detail.history } : null}
      canManage={canManageTeams(actor)}
      managers={options.managers}
      candidates={options.candidates}
      params={params}
    />
    {detail && allScoreRows.length ? (
      <PanelCard title={`Agent scores · ${detail.team.name}${scoreRows.length !== allScoreRows.length ? ` · ${scoreRows.length} of ${allScoreRows.length}` : ""}`} id="agent-scores" className="scroll-mt-24">
        <CardFilter
          path="/dashboard/teams"
          params={params}
          label="Filter agent scores"
          search={{ name: "sq", placeholder: "Agent name" }}
          selects={[
            {
              name: "sshow",
              label: "Show",
              all: "All agents",
              options: [
                { value: "low", label: "Score below 50" },
                { value: "provisional", label: "Provisional only" },
                { value: "settled", label: "Enough history" },
              ],
            },
          ]}
        />
        <p className="mb-3 text-[11px] text-zinc-500">
          Score = performance (follow-ups done, first touch within a day) and conversion (booked ÷ decided), weighted as in Settings → Assignment. A
          new or quiet agent starts at 50 and is marked provisional until there is enough history.
        </p>
        <table className="w-full text-left text-xs" aria-label="Agent scores">
          <thead className="text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
            <tr>
              <th scope="col" className="py-2 pr-3">Agent</th>
              <th scope="col" className="py-2 pr-3 text-right">Score</th>
              <th scope="col" className="py-2 pr-3 text-right">Performance</th>
              <th scope="col" className="py-2 pr-3 text-right">Conversion</th>
              <th scope="col" className="py-2 text-right">Open leads</th>
            </tr>
          </thead>
          <tbody>
            {scoreRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-zinc-500">
                  No agents match these filters.
                </td>
              </tr>
            ) : null}
            {scoreRows.map((m) => {
              const s = scores.get(m.id)!;
              return (
                <tr key={m.id} className="border-t border-zinc-100">
                  <td className="py-2 pr-3 font-semibold">
                    {/* Opens the agent's full work profile (15 Nov 2026). */}
                    <Link href={`/dashboard/people/${m.id}`} className="hover:text-brand hover:underline">
                      {m.name}
                    </Link>
                    {s.provisional ? <span className="ml-2 text-[10px] font-bold text-zinc-500">Provisional</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-right font-black tabular-nums">{s.score}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{s.performance}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{s.conversion}</td>
                  <td className="py-2 text-right tabular-nums">{formatInt(s.openLeads)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </PanelCard>
    ) : null}
    </>
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
          Each agent&apos;s day, filled from the CRM. The team admin adds remarks, corrects a number if needed and confirms; past reports are listed below. It can be
          confirmed on the day or the day after.
        </p>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TeamSelect params={params} teams={teams} />
          <div>
            <DateParam params={params} name="date" label="Report date" value={date} />
            <DayStepper params={params} date={date} today={today} />
          </div>
        </div>
        <h4 className="mb-2 text-xs font-black">Agent entries</h4>
        {report ? (
          <DailyReportForm key={`${report.team.id}-${date}`} teamId={report.team.id} date={date} rows={report.rows} canEdit={report.canEdit} lockedReason={report.lockedReason} submitted={report.submitted} />
        ) : (
          <EmptyState size="sm">Select a team to enter today&apos;s report.</EmptyState>
        )}
      </PanelCard>
      <PanelCard title="Date-wise submissions">
        <p className="-mt-1 mb-4 text-[11px] text-zinc-500">Every team&apos;s confirmed reports. Click a row to open that day.</p>
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
      <p className="mb-4 text-[11px] text-zinc-500">Who is in the office, out on site, on leave, or not taking new leads today. Check-ins and approved leave fill it in; mark only the exceptions.</p>
      <div className="mb-4 grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
        <TeamSelect params={params} teams={teams} />
        <SegmentParam params={params} name="view" label="View" value={view} options={[{ value: "day", label: "Day" }, { value: "month", label: "Month" }]} />
        {view === "day" ? (
          <div>
            <DateParam params={params} name="date" label="Date" value={date} />
            <DayStepper params={params} date={date} today={today} />
          </div>
        ) : (
          <DateParam params={params} name="month" label="Month" type="month" value={month} />
        )}
      </div>
      {!team ? (
        <EmptyState size="sm">Select a team to edit the roster.</EmptyState>
      ) : day ? (
        <>
          {day.holiday ? <p className="mb-3 rounded-xl bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700">Company holiday: {day.holiday}.</p> : null}
          {day.team.weekendDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? <p className="mb-3 rounded-xl bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700">This day is a weekly day off.</p> : null}
          <RosterDayForm
            key={`${day.team.id}-${date}`}
            teamId={day.team.id}
            date={date}
            rows={day.rows}
            canEdit={day.canEdit}
            locked={day.locked}
            note={
              day.locked
                ? date < today
                  ? "Past days are view only."
                  : "Today's roster could be changed until 11:00. View only now."
                : date === today
                  ? "You can change today's roster until 11:00, and future days any time."
                  : null
            }
          />
        </>
      ) : monthGrid ? (
        <RosterMonthGrid days={monthGrid.days} rows={monthGrid.rows} weekendDays={monthGrid.team.weekendDays} dayHref={(d) => withParams("/dashboard/teams", params, { tab: "roster", view: "day", date: d })} />
      ) : null}
      <p className="mt-4 text-[11px] text-zinc-500">Agents marked On leave or Leads off for a day get no new leads that day from automatic assignment.</p>
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
