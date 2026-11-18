import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { STATUS_TONES } from "@/features/attendance/components/check-in-card";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { flattenParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { ATTENDANCE_STATUS_LABELS } from "@/modules/attendance/rules";
import { LEAD_STAGES, STAGE_LABELS } from "@/modules/leads/constants";
import { buttonClasses } from "@/components/ui/button";
import { addDays } from "@/modules/teams/dates";
import { myTeamView } from "@/modules/teams/my-team";
import { ROSTER_STATUS_LABELS } from "@/modules/teams/validation";
import { periodLabel } from "@/modules/targets/period";
import { TARGET_METRICS } from "@/modules/targets/service";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "My team" };

const th = "px-3 py-2.5";
const field = "h-9 rounded-xl border border-zinc-200/80 bg-white px-3 text-xs font-semibold shadow-hairline focus:border-brand/50 focus:outline-none";
const OPEN_STAGES = LEAD_STAGES.filter((s) => s !== "booked" && s !== "lost_lead");
const td = "px-3 py-2 whitespace-nowrap";
const pctText = (v: number | null) => (v === null ? "—" : `${v}%`);
const PERIOD_NAMES: Record<string, string> = { daily: "Today", weekly: "This week", monthly: "This month", custom: "Own dates" };

/** A Team Lead's read-only view of the team they lead (owner, 15 Nov 2026). */
export default async function MyTeamPage({ searchParams }: PageProps<"/dashboard/my-team">) {
  const actor = await requirePageUser();
  if (actor.role !== "agent" || !actor.ledTeamIds?.length) return <RestrictedState />;
  const q = flattenParams(await searchParams);
  const v = await myTeamView(getDb(), actor, q.team, q);
  const now = new Date();
  const lf = v.leadFilters;
  const leadsFiltered = Boolean(lf.q || lf.agent || lf.stage || lf.due);
  /** Same page with the range and lead filters kept, plus `extra`. */
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(v.teams.length > 1 ? { team: v.team.id } : {}), from: v.range.from, to: v.range.to });
    for (const [k, val] of Object.entries({ lq: lf.q, lagent: lf.agent, lstage: lf.stage, ldue: lf.due, ...extra })) if (val) p.set(k, val);
    return `/dashboard/my-team?${p}`;
  };
  const base = (extra: Record<string, string>) => `/dashboard/my-team?${new URLSearchParams({ ...(v.teams.length > 1 ? { team: v.team.id } : {}), ...extra })}`;
  const presets = [
    { label: "Today", from: v.today },
    { label: "7 days", from: addDays(v.today, -6) },
    { label: "30 days", from: addDays(v.today, -30) },
    { label: "This month", from: `${v.today.slice(0, 7)}-01` },
  ];
  const sum = (f: (m: (typeof v.members)[number]) => number) => v.members.reduce((n, m) => n + f(m), 0);

  return (
    <PageStack>
      <PageHeader title={`My team · ${v.team.name}`} icon={Users} description="You are this team's Team Lead: your agents' figures, scores and targets. Everything here is view-only; Admins handle approvals, reassigning and targets." />
      {v.teams.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {v.teams.map((t) => (
            <Link key={t.id} href={`/dashboard/my-team?team=${t.id}`} aria-current={t.id === v.team.id ? "true" : undefined} className={cn("rounded-lg border px-3 py-1.5 text-xs font-bold", t.id === v.team.id ? "border-brand bg-brand text-white" : "border-zinc-200/80 bg-white text-zinc-700")}>
              {t.name}
            </Link>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {presets.map((r) => {
          const on = v.range.from === r.from && v.range.to === v.today;
          return (
            <Link key={r.label} href={base({ from: r.from, to: v.today })} aria-current={on ? "true" : undefined} className={cn("rounded-lg border px-3 py-1.5 text-xs font-bold", on ? "border-brand bg-brand text-white" : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50")}>
              {r.label}
            </Link>
          );
        })}
        <form method="get" action="/dashboard/my-team" className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-zinc-500" aria-label="Custom dates">
          {v.teams.length > 1 ? <input type="hidden" name="team" value={v.team.id} /> : null}
          <input type="date" name="from" aria-label="From" defaultValue={v.range.from} max={v.today} className={field} />
          to
          <input type="date" name="to" aria-label="To" defaultValue={v.range.to} max={v.today} className={field} />
          <button type="submit" className={buttonClasses({ variant: "secondary", size: "md" })}>
            Show
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MiniStat label="Members" value={String(v.members.length)} caption="Active agents" />
        <MiniStat label="Open leads" value={String(sum((m) => m.open))} caption="Right now" />
        <MiniStat label="Overdue follow-ups" value={String(sum((m) => m.overdue))} caption="Right now" />
        <MiniStat label="Calls" value={String(sum((m) => m.metrics.calls))} caption="In range" />
        <MiniStat label="Meetings held" value={String(sum((m) => m.metrics.meetings))} caption="In range" />
        <MiniStat label="Won" value={String(sum((m) => m.metrics.booked))} caption="Leads booked, in range" />
      </div>

      <PanelCard title="Members">
        <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
          <table className="w-full min-w-max border-collapse text-left text-xs">
            <thead className="bg-zinc-100">
              <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                <th scope="col" className={th}>Agent</th>
                <th scope="col" className={th}>Today</th>
                <th scope="col" className={th}>Roster</th>
                <th scope="col" className={th}>Open leads</th>
                <th scope="col" className={th}>Overdue follow-ups</th>
                <th scope="col" className={th}>Calls · min</th>
                <th scope="col" className={th}>Meetings</th>
                <th scope="col" className={th}>Won · lost</th>
                <th scope="col" className={th} title="Booked out of leads that ended (booked or lost), in the range">
                  Win %
                </th>
                <th scope="col" className={th} title="Follow-ups done out of those due, in the range">
                  Follow-up %
                </th>
                <th scope="col" className={th} title="Agent score, 0–100: follow-up performance and conversion. prov. = too little history yet">
                  Score
                </th>
                <th scope="col" className={th} title="Goals reached out of goals set, for targets starting in the range">
                  Targets met
                </th>
              </tr>
            </thead>
            <tbody>
              {v.members.map((m) => (
                <tr key={m.id} className="border-b border-zinc-100/80 last:border-b-0">
                  <td className={cn(td, "font-bold")}>
                    <Link href={`/dashboard/my-team/${m.id}?${new URLSearchParams({ from: v.range.from, to: v.range.to })}`} className="hover:text-brand hover:underline" title="Open this agent's KPIs">
                      {m.name}
                    </Link>
                    {m.isMe ? <span className="ml-1.5 text-[10px] font-semibold text-zinc-500">(you)</span> : null}
                  </td>
                  <td className={td}>
                    <StatusTag tone={STATUS_TONES[m.attendance]}>{ATTENDANCE_STATUS_LABELS[m.attendance]}</StatusTag>
                  </td>
                  <td className={td}>{m.roster ? ROSTER_STATUS_LABELS[m.roster] : "—"}</td>
                  <td className={cn(td, "tabular-nums")}>{m.open}</td>
                  <td className={cn(td, "tabular-nums", m.overdue ? "font-bold text-rose-700" : "")}>{m.overdue}</td>
                  <td className={cn(td, "tabular-nums")}>
                    {m.metrics.calls} · {m.metrics.callMin ?? "—"}
                  </td>
                  <td className={cn(td, "tabular-nums")}>{m.metrics.meetings}</td>
                  <td className={cn(td, "tabular-nums")}>
                    {m.metrics.booked} · {m.metrics.lost}
                  </td>
                  <td className={cn(td, "tabular-nums")}>{pctText(m.metrics.winPct)}</td>
                  <td className={cn(td, "tabular-nums", m.metrics.fuPct !== null && m.metrics.fuPct < 50 ? "font-bold text-rose-700" : "")}>{pctText(m.metrics.fuPct)}</td>
                  <td className={cn(td, "tabular-nums font-bold")}>
                    {m.score ?? "—"}
                    {m.scoreProvisional ? <span className="ml-1 text-[10px] font-semibold text-zinc-500">prov.</span> : null}
                  </td>
                  <td className={cn(td, "tabular-nums")}>{m.targetsSet ? `${m.targetsMet} of ${m.targetsSet}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>

      <PanelCard title="Targets now">
        {v.members.every((m) => m.targetsNow.length === 0) ? (
          <p className="text-xs text-zinc-500">No targets are running for this team today. Admins set them on the Targets page.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <thead className="bg-zinc-100">
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className={th}>Agent</th>
                  <th scope="col" className={th}>Period</th>
                  {TARGET_METRICS.map((t) => (
                    <th key={t.key} scope="col" className={th}>
                      {t.label}
                    </th>
                  ))}
                  <th scope="col" className={th}>Custom goals</th>
                </tr>
              </thead>
              <tbody>
                {v.members.flatMap((m) =>
                  m.targetsNow.map((t) => (
                    <tr key={`${m.id}-${t.period}-${t.start}`} className="border-b border-zinc-100/80 last:border-b-0">
                      <td className={cn(td, "font-bold")}>{m.name}</td>
                      <td className={td}>
                        {PERIOD_NAMES[t.period]}
                        {t.period === "custom" ? <span className="block text-[10px] text-zinc-500">{periodLabel(t.period, t.start, t.end)}</span> : null}
                      </td>
                      {TARGET_METRICS.map((x) => {
                        const goal = t.goals![x.key];
                        const got = t.achieved[x.key];
                        return (
                          <td key={x.key} className={cn(td, "tabular-nums")}>
                            {goal > 0 ? (
                              <span className={got >= goal ? "font-bold text-emerald-700" : ""}>
                                {got.toLocaleString("en-PK")} / {goal.toLocaleString("en-PK")}
                                {got >= goal ? " · Met" : ` · ${Math.round((got / goal) * 100)}%`}
                              </span>
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className={td}>
                        {t.custom.length ? t.custom.map((g) => `${g.name} ${g.achieved}/${g.goal}${g.met ? " ✓" : ""}`).join(" · ") : <span className="text-zinc-400">—</span>}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>

      <PanelCard title={`Team's open leads · ${v.openTotal}`}>
        <form method="get" action="/dashboard/my-team" role="search" aria-label="Filter the team's open leads" className="mb-3 flex flex-wrap items-center gap-2">
          {v.teams.length > 1 ? <input type="hidden" name="team" value={v.team.id} /> : null}
          <input type="hidden" name="from" value={v.range.from} />
          <input type="hidden" name="to" value={v.range.to} />
          <input type="search" name="lq" defaultValue={lf.q} placeholder="Lead name or code" maxLength={100} autoComplete="off" className={cn(field, "min-w-0 flex-1 basis-48")} />
          <select name="lagent" defaultValue={lf.agent} aria-label="Agent" className={field}>
            <option value="">All agents</option>
            {v.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select name="lstage" defaultValue={lf.stage} aria-label="Stage" className={field}>
            <option value="">All stages</option>
            {OPEN_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
            <input type="checkbox" name="ldue" value="overdue" defaultChecked={lf.due === "overdue"} className="size-4 accent-brand" />
            Follow-up overdue
          </label>
          <button type="submit" className={buttonClasses({ variant: "primary", size: "md" })}>
            Filter
          </button>
          {leadsFiltered ? (
            <Link href={keep({ lq: "", lagent: "", lstage: "", ldue: "" })} className={buttonClasses({ variant: "secondary", size: "md" })}>
              Clear
            </Link>
          ) : null}
        </form>
        {v.openLeads.length === 0 ? (
          <p className="text-xs text-zinc-500">{leadsFiltered ? "No open leads match these filters." : "No open leads."}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <thead className="bg-zinc-100">
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className={th}>Lead</th>
                  <th scope="col" className={th}>Stage</th>
                  <th scope="col" className={th}>Agent</th>
                  <th scope="col" className={th}>Next follow-up</th>
                  <th scope="col" className={th}>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {v.openLeads.map((l) => (
                  <tr key={l.id} className="border-b border-zinc-100/80 last:border-b-0">
                    <td className={td}>
                      {l.mine ? (
                        <Link href={`/dashboard/leads/${l.id}`} className="font-bold text-brand hover:underline">
                          {l.name}
                        </Link>
                      ) : (
                        <span className="font-bold">{l.name}</span>
                      )}
                      <span className="ml-1.5 text-zinc-500">{l.code}</span>
                    </td>
                    <td className={td}>{STAGE_LABELS[l.stage]}</td>
                    <td className={td}>{l.ownerName}</td>
                    <td className={cn(td, l.nextFollowUpAt && new Date(l.nextFollowUpAt) < now ? "font-bold text-rose-700" : "")}>{l.nextFollowUpAt ? formatDateTime(l.nextFollowUpAt) : "—"}</td>
                    <td className={td}>{formatDateTime(l.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {v.leadMatches ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
            <span>
              Showing {(v.leadPage.page - 1) * 50 + 1}–{(v.leadPage.page - 1) * 50 + v.openLeads.length} of {v.leadMatches}
              {leadsFiltered ? ` (filtered from ${v.openTotal})` : ""}, earliest follow-up first
            </span>
            {v.leadPage.pageCount > 1 ? (
              <span className="flex gap-2">
                {v.leadPage.page > 1 ? (
                  <Link href={keep({ lpage: String(v.leadPage.page - 1) })} className={buttonClasses({ variant: "secondary", size: "md" })}>
                    Previous
                  </Link>
                ) : null}
                {v.leadPage.page < v.leadPage.pageCount ? (
                  <Link href={keep({ lpage: String(v.leadPage.page + 1) })} className={buttonClasses({ variant: "secondary", size: "md" })}>
                    Next
                  </Link>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="mt-2 text-[11px] text-zinc-500">You can open your own leads. Other agents&apos; leads are listed for your overview only.</p>
      </PanelCard>
    </PageStack>
  );
}
