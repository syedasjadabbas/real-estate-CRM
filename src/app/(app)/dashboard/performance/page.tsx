import { formatDuration } from "@/features/leads/format";
import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { canViewProfiles } from "@/modules/people/profile";
import type { ReactNode } from "react";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { findNavItem } from "@/config/navigation";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams, withParams } from "@/features/leads/url";
import { CallQuality, CallVolume, CallsVsMeetings, OutcomeMix, TopClosers } from "@/features/performance/components/charts";
import { Search } from "lucide-react";
import { PerformanceFilters } from "@/features/performance/components/performance-filters";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { businessToday } from "@/modules/bookings/today";
import type { PerformanceSort } from "@/modules/performance/range";
import { canViewPerformance, performanceContexts, performanceReport, pipelineByAgent, teamComparison } from "@/modules/performance/service";
import { LEAD_STAGES, STAGE_LABELS } from "@/modules/leads/constants";
import { getProjectScope } from "@/server/project-scope";
import { signinRetentionNote } from "@/modules/security/service";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { formatTalkTime } from "@/modules/performance/pipeline-export";

export const metadata: Metadata = { title: "Performance" };

const NO_CALL_DURATION = "No call recording in the range has a duration";

/** Observed columns, in order. */
const COLUMNS: { label: string; sort: PerformanceSort; title?: string }[] = [
  { label: "Name", sort: "agent" },
  { label: "Score", sort: "score", title: "Agent score, 0–100: follow-up performance and conversion, weighted in Settings → Assignment & scores. It doesn't decide who gets leads. \"prov.\" = too little history yet." },
  { label: "Open leads", sort: "open", title: "Leads assigned in the selected date range that are not booked or lost." },
  { label: "Booked", sort: "booked", title: "Leads assigned in the range that are now Booked." },
  { label: "Lost", sort: "lost", title: "Leads assigned in the range that are now Lost." },
  { label: "Win %", sort: "winPct", title: "Booked ÷ (booked + lost)." },
  { label: "Calls", sort: "calls", title: "Call recordings the agent uploaded to a lead in the range (one recording = one call)." },
  { label: "Call min", sort: "callMin", title: "Total duration of those recordings, in minutes, counting recordings that have a duration." },
  { label: "F/U due", sort: "fuDue", title: "Follow-ups due in the range (not cancelled)." },
  { label: "F/U done", sort: "fuDone", title: "Of those, follow-ups marked done." },
  { label: "F/U %", sort: "fuPct", title: "Done ÷ due." },
  { label: "Meetings", sort: "meetings", title: "Completed meetings the agent organized, starting in the range." },
  { label: "CRM sign-ins", sort: "signIns", title: "CRM sign-ins logged in the range (authentication activity, not attendance)." },
  { label: "CRM sign-outs", sort: "signOuts", title: "CRM sign-outs logged in the range (authentication activity, not attendance)." },
  { label: "Targets met", sort: "targetsMet", title: "Target goals reached (calls, meetings, sold sq ft), of those set, for targets whose day, week or month starts in the range." },
  { label: "Avg first touch", sort: "avgFirstTouchMs", title: "Average time from creation to first touch, for leads assigned in the range that have been touched." },
  { label: "Call review", sort: "reviewAvg", title: "Average score (1–5) Admins gave this agent's calls in Call reviews & notes during the range, and how many scored reviews." },
];

const pctText = (v: number | null) => (v === null ? "—" : `${v}%`);

/**
 * "Find an agent" (16 Nov 2026). One search shared by the agent table and Pipeline by agent: typing in
 * either box filters both, so the two tables always list the same people. `anchor` keeps the reader at
 * the table they searched from.
 */
function AgentSearch({ params, search, shown, total, anchor }: { params: Record<string, string>; search: string; shown: number; total: number; anchor?: string }) {
  const hash = anchor ? `#${anchor}` : "";
  return (
    <form method="get" action={`/dashboard/performance${hash}`} role="search" aria-label="Find an agent" className="flex flex-wrap items-center gap-2">
      {Object.entries(params)
        .filter(([k]) => !["q", "page"].includes(k))
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <label className="relative min-w-0 flex-1 basis-56 sm:max-w-xs">
        <span className="sr-only">Agent name</span>
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Find an agent by name"
          maxLength={100}
          autoComplete="off"
          className="h-9 w-full rounded-xl border border-zinc-200/80 bg-white pr-3 pl-8 text-xs font-semibold shadow-hairline focus:border-brand/50 focus:outline-none"
        />
      </label>
      <button type="submit" className={buttonClasses({ variant: "secondary", size: "md" })}>
        Search
      </button>
      {search ? (
        <Link href={`${withParams("/dashboard/performance", params, { q: null, page: null })}${hash}`} className={buttonClasses({ variant: "secondary", size: "md" })}>
          Clear
        </Link>
      ) : null}
      <Badge tone="neutral" className="ml-auto">
        {search ? `${formatInt(shown)} of ${formatInt(total)}` : formatInt(total)} {total === 1 ? "person" : "people"}
        {search ? ` · “${search}”` : ""}
      </Badge>
    </form>
  );
}

function Glance({ label, value, caption, muted }: { label: string; value: ReactNode; caption: ReactNode; muted?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 shadow-hairline", muted && "bg-zinc-50")}>
      <p className="text-[9px] leading-[13.5px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</p>
      <p className={cn("text-2xl leading-8 font-black tabular-nums", muted && "text-zinc-400")}>{value}</p>
      <p className="text-[11px] font-semibold text-zinc-600">{caption}</p>
    </div>
  );
}

export default async function PerformancePage({ searchParams }: PageProps<"/dashboard/performance">) {
  const actor = await requirePageUser();
  // Admins and Super Admins open an agent's full profile from their name (15 Nov 2026).
  const profileLinks = canViewProfiles(actor);
  const item = findNavItem("/dashboard/performance")!;
  if (!canViewPerformance(actor)) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const db = getDb();
  const isAgent = actor.role === "agent";
  const today = businessToday();
  const [report, contexts, retentionNote, scope, teamRows] = await Promise.all([
    performanceReport(db, actor, params),
    performanceContexts(db, actor),
    signinRetentionNote(db),
    getProjectScope(),
    teamComparison(db, actor, params),
  ]);
  const project = scope.projects.find((p) => p.id === scope.activeProjectId) ?? null;
  // Pipeline by agent: each agent's leads by stage right now, in the project selected in the header.
  const pipeline = project ? await pipelineByAgent(db, report.allRows.map((r) => r.userId), project.id) : null;
  const s = report.summary;
  // An agent sees only themselves: personal wording, no per-agent averages, no ranking charts.
  const own = report.context === "own";
  const decided = s.booked + s.lost;
  const csvQuery = new URLSearchParams({ from: report.range.from, to: report.range.to, ...(report.team ? { team: report.team } : {}) }).toString();
  const sortHref = (key: PerformanceSort) =>
    withParams("/dashboard/performance", params, { sort: key, dir: report.sort === key && report.dir === "asc" ? "desc" : "asc", page: null });

  return (
    <PageStack>
      <PageHeader
        title={isAgent ? "My performance" : "Performance"}
        description={isAgent ? "Your leads, calls, follow-ups and meetings. Your leave and sign-ins are in My workplace." : "How each agent is doing on leads, follow-ups, calls, meetings and bookings, for the dates you pick."}
        icon={item.icon}
        actions={
          <PerformanceFilters
            params={params}
            from={report.range.from}
            to={report.range.to}
            contexts={contexts}
            allLabel={actor.role === "agent" ? null : actor.role === "manager" ? "My teams" : "All agents"}
            generatedAt={report.generatedAt}
            today={today}
          />
        }
      />

      <Panel
        title={own ? "Your performance" : "Team at a glance"}
        description={own ? `${report.range.from} → ${report.range.to}` : `${formatInt(s.agents)} ${s.agents === 1 ? "person" : "people"} in scope · ${report.range.from} → ${report.range.to}`}
      >
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Glance label="Win rate" value={pctText(s.winPct)} caption={`${formatInt(s.booked)} booked of ${formatInt(decided)} decided leads`} />
            <Glance label="Follow-ups done" value={pctText(s.fuPct)} caption={`${formatInt(s.fuDone)} of ${formatInt(s.fuDue)} due in the range`} />
            <Glance
              label="Qualified calls"
              value={formatInt(s.callsQualified)}
              caption={s.calls === 0 ? "No call recordings in the range" : `60 s or longer · ${formatInt(s.callsVerified)} were 30 s+ · ${formatInt(s.callsTimed)} of ${formatInt(s.calls)} have a length`}
              muted={s.calls === 0}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200/80 p-3">
              <p className="mb-2 text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase">Pipeline</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Glance label="Open leads" value={formatInt(s.open)} caption={own ? "In range" : `${s.perAgent.open} per agent`} />
                <Glance label="Booked" value={formatInt(s.booked)} caption="In range" />
                <Glance label="Lost" value={formatInt(s.lost)} caption="In range" />
              </div>
              {decided > 0 ? (
                <div className="mt-3 space-y-1">
                  <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100" role="img" aria-label={`Booked ${s.booked}, lost ${s.lost}`}>
                    <span className="bg-brand" style={{ width: `${(s.booked / decided) * 100}%` }} />
                    <span className="bg-rose-500" style={{ width: `${(s.lost / decided) * 100}%` }} />
                  </div>
                  <p className="flex justify-between text-[11px] font-semibold text-zinc-600">
                    <span>
                      Booked {formatInt(s.booked)} · {Math.round((s.booked / decided) * 100)}%
                    </span>
                    <span>
                      Lost {formatInt(s.lost)} · {Math.round((s.lost / decided) * 100)}%
                    </span>
                  </p>
                </div>
              ) : null}
            </div>
            <div className="rounded-2xl border border-zinc-200/80 p-3">
              <p className="mb-2 text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase">Activity</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Glance
                  label="Calls"
                  value={formatInt(s.calls)}
                  caption={`${own ? "" : `${s.perAgent.calls} per agent · `}${s.callMin === null ? "— min" : `${formatInt(s.callMin)} min`}`}
                />
                <Glance label="Meetings" value={formatInt(s.meetings)} caption={own ? "Completed" : `${s.perAgent.meetings} per agent`} />
                <Glance label="CRM sign-ins" value={formatInt(s.signIns)} caption={own ? "Not attendance" : `${s.perAgent.signIns} per agent · not attendance`} />
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <OutcomeMix mix={report.charts.outcomeMix} winPct={s.winPct} />
        {own ? null : <TopClosers rows={report.charts.topClosers} />}
        {s.calls === 0 ? (
          <Panel title="Calls" description="Call quality and call leaders">
            <EmptyState size="sm">
              No call recordings were uploaded in this range. Calls are counted from recordings agents upload on a lead&apos;s page; call quality and the call leaders
              appear here once there are some.
            </EmptyState>
          </Panel>
        ) : (
          <>
            <CallQuality data={report.charts.callQuality} />
            {own ? null : <CallVolume rows={report.charts.callVolume} />}
          </>
        )}
        {own ? null : <CallsVsMeetings rows={report.charts.callsVsMeetings} />}
      </div>

      {teamRows.length > 0 && !report.team ? (
        <Panel
          title="Teams compared"
          description={`Each active team's agents added together · ${report.range.from} → ${report.range.to}. Click a team to see its agents.`}
          bodyClassName="space-y-3"
        >
          <div className="overflow-auto rounded-xl border border-zinc-200/80">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <thead className="bg-zinc-100">
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  {["Team", "Agents", "Open leads", "Booked", "Lost", "Win %", "Calls", "Call min", "Qualified calls", "F/U %", "Meetings"].map((h, i) => (
                    <th key={h} scope="col" className={cn("px-3 py-3.5 whitespace-nowrap", i > 0 && "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teamRows.map((t) => (
                  <tr key={t.teamId} className="border-b border-zinc-100/80 last:border-b-0 hover:bg-zinc-50/60">
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap">
                      <Link href={withParams("/dashboard/performance", params, { team: t.teamId, page: null })} className="hover:text-brand hover:underline">
                        {t.name}
                      </Link>
                    </td>
                    {[t.agents, t.open, t.booked, t.lost, pctText(t.winPct), t.calls, t.callMin, t.callsQualified, pctText(t.fuPct), t.meetings].map((v, i) => (
                      <td key={i} className={cn("px-3 py-2.5 text-right tabular-nums", v === null && "text-zinc-400")}>
                        {v === null ? "—" : typeof v === "number" ? formatInt(v) : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-zinc-500">An agent who belongs to two teams is counted in both. Admins who own leads but are in no team are not in any row.</p>
        </Panel>
      ) : null}

      <Panel
        title={own ? "Your figures & CRM sign-in activity" : "Performance & CRM sign-in activity"}
        description={own ? "Your figures for the chosen dates." : "One row per agent for the chosen dates. Click a column to sort it, or a name to open that person's work profile. Hover a column title for what it counts."}
        actions={
          <a href={`/api/v1/performance/export?${csvQuery}`} className={buttonClasses({ variant: "secondary", className: "h-[33px] px-3 text-xs" })} download>
            <Download aria-hidden="true" className="size-3.5" />
            Export CSV
          </a>
        }
        bodyClassName="space-y-3"
      >
        {own ? null : (
          <AgentSearch params={params} search={report.search} shown={report.total} total={s.agents} />
        )}
        {report.total === 0 ? (
          <EmptyState>{report.search ? `No agent matches “${report.search}”.` : "No agents in this scope."}</EmptyState>
        ) : (
          <div className="max-h-[540px] overflow-auto rounded-xl border border-zinc-200/80">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-100">
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  {COLUMNS.map((c) => (
                    <th
                      key={c.label}
                      scope="col"
                      title={c.title}
                      aria-sort={c.sort === report.sort ? (report.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn("px-3 py-3.5 whitespace-nowrap", c.sort !== "agent" && "text-right")}
                    >
                      <Link href={sortHref(c.sort)} className="inline-flex items-center gap-1.5 hover:text-zinc-900" aria-label={`Sort by ${c.label}`}>
                        {c.label}
                        <span aria-hidden="true" className="flex flex-col text-[7px] leading-[7px]">
                          <span className={cn(report.sort === c.sort && report.dir === "asc" ? "text-brand" : "text-zinc-300")}>▲</span>
                          <span className={cn(report.sort === c.sort && report.dir === "desc" ? "text-brand" : "text-zinc-300")}>▼</span>
                        </span>
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.userId} className="border-b border-zinc-100/80 last:border-b-0 hover:bg-zinc-50/60">
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap">{profileLinks ? <Link href={`/dashboard/people/${r.userId}`} className="hover:text-brand hover:underline">{r.name}</Link> : r.name}</td>
                    <td className={cn("px-3 py-2.5 text-right whitespace-nowrap tabular-nums", r.score === null && "text-zinc-400")}>
                      {r.score === null ? "—" : r.score}
                      {r.scoreProvisional ? <span className="ml-1 text-[10px] font-semibold text-zinc-400">prov.</span> : null}
                    </td>
                    {[r.open, r.booked, r.lost, pctText(r.winPct), r.calls, r.callMin, r.fuDue, r.fuDone, pctText(r.fuPct), r.meetings, r.signIns, r.signOuts].map((v, i) => (
                      <td key={i} className={cn("px-3 py-2.5 text-right tabular-nums", v === null && "text-zinc-400")} title={v === null ? NO_CALL_DURATION : undefined}>
                        {v === null ? "—" : typeof v === "number" ? formatInt(v) : v}
                      </td>
                    ))}
                    <td className={cn("px-3 py-2.5 text-right whitespace-nowrap tabular-nums", r.targetsSet === 0 && "text-zinc-400")}>
                      {r.targetsSet === 0 ? "—" : (
                        <>
                          <span className={r.targetsMet > 0 ? "font-bold text-brand" : undefined}>{r.targetsMet}</span>
                          <span className="text-zinc-400"> / {r.targetsSet}</span>
                        </>
                      )}
                    </td>
                    <td className={cn("px-3 py-2.5 text-right whitespace-nowrap tabular-nums", r.avgFirstTouchMs === null && "text-zinc-400")}>{formatDuration(r.avgFirstTouchMs)}</td>
                    <td className={cn("px-3 py-2.5 text-right whitespace-nowrap tabular-nums", r.reviewAvg === null && "text-zinc-400")}>
                      {r.reviewAvg === null ? "—" : (
                        <>
                          <span className="font-bold text-zinc-800">{r.reviewAvg.toFixed(1)}</span>
                          <span className="text-zinc-400"> / 5 · {r.reviewCount}</span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={report.page} pageCount={report.pageCount} total={report.total} params={params} />
        <p className="text-[11px] text-zinc-500">
          Calls are call recordings uploaded to a lead (one recording = one call), counted for the agent who uploaded them on the upload date; hidden recordings are
          not counted. Call minutes add up the recordings that have a duration (&quot;—&quot; when none does). Leads are counted under their current owner, on their
          original assignment date.
        </p>
        <p className="text-[11px] text-zinc-500">
          CRM sign-ins and sign-outs are authentication activity only. They are not attendance and are not used to work out hours, lateness or absences; see HR → Attendance for check-ins.{" "}
          {retentionNote}
        </p>
      </Panel>

      {pipeline && project ? (
        <div id="pipeline" className="scroll-mt-20">
        <Panel
          title={own ? "Your pipeline" : "Pipeline by agent"}
          description={`Leads held right now in each stage · ${project.name} · not limited to the date range. Talk time is the length of call recordings in the date range. Click a number to open those leads.`}
          actions={
            <a
              href={`/api/v1/performance/pipeline-export?${new URLSearchParams({ from: report.range.from, to: report.range.to, ...(report.team ? { team: report.team } : {}), ...(report.search ? { q: report.search } : {}) })}`}
              className={buttonClasses({ variant: "secondary", className: "h-[33px] px-3 text-xs" })}
              download
            >
              <Download aria-hidden="true" className="size-3.5" />
              Export CSV
            </a>
          }
          bodyClassName="space-y-3"
        >
          {own ? null : <AgentSearch params={params} search={report.search} shown={report.total} total={s.agents} anchor="pipeline" />}
          {report.matched.length === 0 ? (
            <EmptyState>{report.search ? `No agent matches “${report.search}”.` : "No agents in this scope."}</EmptyState>
          ) : (
            <div className="max-h-[540px] overflow-auto rounded-xl border border-zinc-200/80">
              <table className="w-full min-w-max border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-zinc-100">
                  <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">Name</th>
                    {LEAD_STAGES.map((st) => (
                      <th key={st} scope="col" className="px-3 py-3.5 text-right whitespace-nowrap">
                        {STAGE_LABELS[st]}
                      </th>
                    ))}
                    <th scope="col" className="px-3 py-3.5 text-right whitespace-nowrap">Total</th>
                    <th scope="col" className="px-3 py-3.5 text-right whitespace-nowrap" title="Total length of the call recordings uploaded in the date range (only recordings with a known length)">
                      Talk time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.matched.map((r) => {
                    const counts = pipeline.get(r.userId);
                    const total = counts ? LEAD_STAGES.reduce((a, st) => a + counts[st], 0) : 0;
                    return (
                      <tr key={r.userId} className="border-b border-zinc-100/80 last:border-b-0 hover:bg-zinc-50/60">
                        <td className="px-3 py-2.5 font-bold whitespace-nowrap">{profileLinks ? <Link href={`/dashboard/people/${r.userId}`} className="hover:text-brand hover:underline">{r.name}</Link> : r.name}</td>
                        {LEAD_STAGES.map((st) => {
                          const n = counts?.[st] ?? 0;
                          return (
                            <td key={st} className={cn("px-3 py-2.5 text-right tabular-nums", n === 0 && "text-zinc-300")}>
                              {n === 0 ? (
                                "0"
                              ) : (
                                <Link href={`/dashboard/leads?owner=${r.userId}&stage=${st}`} className="font-semibold text-brand hover:underline">
                                  {formatInt(n)}
                                </Link>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 text-right font-black tabular-nums">
                          {total ? (
                            <Link href={`/dashboard/leads?owner=${r.userId}`} className="hover:text-brand hover:underline">
                              {formatInt(total)}
                            </Link>
                          ) : (
                            "0"
                          )}
                        </td>
                        <td className={cn("px-3 py-2.5 text-right font-semibold whitespace-nowrap tabular-nums", !r.callsTimed && "text-zinc-300")} title={`${r.calls} call${r.calls === 1 ? "" : "s"} in range, ${r.callsTimed} with a length`}>
                          {r.callsTimed && profileLinks ? (
                            <Link href={`/dashboard/people/${r.userId}?from=${report.range.from}&to=${report.range.to}#calls`} className="text-brand hover:underline">
                              {formatTalkTime(r.callSeconds, r.callsTimed)}
                            </Link>
                          ) : (
                            formatTalkTime(r.callSeconds, r.callsTimed)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        </div>
      ) : null}
    </PageStack>
  );
}
