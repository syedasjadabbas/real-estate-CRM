import { formatDuration } from "@/features/leads/format";
import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { findNavItem } from "@/config/navigation";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams, withParams } from "@/features/leads/url";
import { NeedsCallData, OutcomeMix, TopClosers } from "@/features/performance/components/charts";
import { PerformanceFilters } from "@/features/performance/components/performance-filters";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import type { PerformanceSort } from "@/modules/performance/range";
import { canViewPerformance, performanceContexts, performanceReport } from "@/modules/performance/service";
import { signinRetentionNote } from "@/modules/security/service";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Performance" };

const NO_CALLS = "Needs call data, which is not recorded yet";

/** Observed columns, in order. `sort: null` = shown but not available (no data in this system). */
const COLUMNS: { label: string; sort: PerformanceSort | null; title?: string }[] = [
  { label: "Agent", sort: "agent" },
  { label: "Open leads", sort: "open", title: "Leads assigned in the selected date range that are not booked or lost." },
  { label: "Booked", sort: "booked", title: "Leads assigned in the range that are now Booked." },
  { label: "Lost", sort: "lost", title: "Leads assigned in the range that are now Lost." },
  { label: "Win %", sort: "winPct", title: "Booked ÷ (booked + lost)." },
  { label: "Calls", sort: null, title: NO_CALLS },
  { label: "Call min", sort: null, title: NO_CALLS },
  { label: "F/U due", sort: "fuDue", title: "Follow-ups due in the range (not cancelled)." },
  { label: "F/U done", sort: "fuDone", title: "Of those, follow-ups marked done." },
  { label: "F/U %", sort: "fuPct", title: "Done ÷ due." },
  { label: "Meetings", sort: "meetings", title: "Completed meetings the agent organized, starting in the range." },
  { label: "CRM sign-ins", sort: "signIns", title: "CRM sign-ins logged in the range (authentication activity, not attendance)." },
  { label: "CRM sign-outs", sort: "signOuts", title: "CRM sign-outs logged in the range (authentication activity, not attendance)." },
  { label: "Avg first touch", sort: "avgFirstTouchMs", title: "Average time from creation to first touch, for leads assigned in the range that have been touched." },
];

const pctText = (v: number | null) => (v === null ? "—" : `${v}%`);

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
  const item = findNavItem("/dashboard/performance")!;
  if (!canViewPerformance(actor)) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const db = getDb();
  const [report, contexts, retentionNote] = await Promise.all([performanceReport(db, actor, params), performanceContexts(db, actor), signinRetentionNote(db)]);
  const s = report.summary;
  const decided = s.booked + s.lost;
  const csvQuery = new URLSearchParams({ from: report.range.from, to: report.range.to, ...(report.team ? { team: report.team } : {}) }).toString();
  const sortHref = (key: PerformanceSort) =>
    withParams("/dashboard/performance", params, { sort: key, dir: report.sort === key && report.dir === "asc" ? "desc" : "asc", page: null });

  return (
    <PageStack>
      <PageHeader
        title="Performance"
        description="Agent KPIs and CRM sign-in activity for your scope (same metrics as team reports)."
        icon={item.icon}
        actions={
          <PerformanceFilters
            params={params}
            from={report.range.from}
            to={report.range.to}
            contexts={contexts}
            allLabel={actor.role === "agent" ? null : actor.role === "manager" ? "My teams" : "All agents"}
            generatedAt={report.generatedAt}
          />
        }
      />

      <Panel
        title="Team at a glance"
        description={`${formatInt(s.agents)} ${s.agents === 1 ? "agent" : "agents"} in scope · ${report.range.from} → ${report.range.to}`}
      >
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Glance label="Win rate" value={pctText(s.winPct)} caption={`${formatInt(s.booked)} booked of ${formatInt(decided)} decided leads`} />
            <Glance label="Follow-ups done" value={pctText(s.fuPct)} caption={`${formatInt(s.fuDone)} of ${formatInt(s.fuDue)} due in the range`} />
            <Glance label="Meaningful calls" value="—" caption="Needs scored call recordings (not captured)" muted />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200/80 p-3">
              <p className="mb-2 text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase">Pipeline</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Glance label="Open leads" value={formatInt(s.open)} caption={`${s.perAgent.open} per agent`} />
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
                <Glance label="Calls" value="—" caption="No call data yet" muted />
                <Glance label="Meetings" value={formatInt(s.meetings)} caption={`${s.perAgent.meetings} per agent`} />
                <Glance label="CRM sign-ins" value={formatInt(s.signIns)} caption={`${s.perAgent.signIns} per agent · not attendance`} />
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <OutcomeMix mix={report.charts.outcomeMix} winPct={s.winPct} />
        <TopClosers rows={report.charts.topClosers} />
        <NeedsCallData title="Call quality" badge="Quality" description="Verified (≥30 s) and qualified (≥60 s) calls" />
        <NeedsCallData title="Call volume leaders" badge="Activity" description="Recordings by agent" />
        <NeedsCallData title="Calls vs meetings" badge="Throughput" description="Top agents by combined activity" />
      </div>

      <Panel
        title="Performance & CRM sign-in activity"
        description="Same KPI columns as team reports: leads, follow-ups, meetings, bookings, calls, and CRM sign-in counts for the date range."
        actions={
          <a href={`/api/v1/performance/export?${csvQuery}`} className={buttonClasses({ variant: "secondary", className: "h-[33px] px-3 text-xs" })} download>
            <Download aria-hidden="true" className="size-3.5" />
            Export CSV
          </a>
        }
        bodyClassName="space-y-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled
            title="The Critical rule has not been defined yet (client decision Q-L8)"
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-zinc-200/80 bg-zinc-50 px-2.5 py-1.5 text-[10px] font-black tracking-[0.05em] text-zinc-400 uppercase"
          >
            Critical only
          </button>
          <span className="text-[11px] text-zinc-500">The Critical flag is not available until its rule is agreed.</span>
          <Badge tone="neutral" className="ml-auto">
            {formatInt(report.total)} {report.total === 1 ? "agent" : "agents"}
          </Badge>
        </div>
        {report.total === 0 ? (
          <EmptyState>No agents in this scope.</EmptyState>
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
                      aria-sort={c.sort && c.sort === report.sort ? (report.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn("px-3 py-3.5 whitespace-nowrap", c.sort !== "agent" && "text-right")}
                    >
                      {c.sort ? (
                        <Link href={sortHref(c.sort)} className="inline-flex items-center gap-1.5 hover:text-zinc-900" aria-label={`Sort by ${c.label}`}>
                          {c.label}
                          <span aria-hidden="true" className="flex flex-col text-[7px] leading-[7px]">
                            <span className={cn(report.sort === c.sort && report.dir === "asc" ? "text-brand" : "text-zinc-300")}>▲</span>
                            <span className={cn(report.sort === c.sort && report.dir === "desc" ? "text-brand" : "text-zinc-300")}>▼</span>
                          </span>
                        </Link>
                      ) : (
                        <span className="text-zinc-400">{c.label}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.userId} className="border-b border-zinc-100/80 last:border-b-0 hover:bg-zinc-50/60">
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap">{r.name}</td>
                    {[r.open, r.booked, r.lost, pctText(r.winPct), null, null, r.fuDue, r.fuDone, pctText(r.fuPct), r.meetings, r.signIns, r.signOuts].map((v, i) => (
                      <td key={i} className={cn("px-3 py-2.5 text-right tabular-nums", v === null && "text-zinc-400")} title={v === null ? NO_CALLS : undefined}>
                        {v === null ? "—" : typeof v === "number" ? formatInt(v) : v}
                      </td>
                    ))}
                    <td className={cn("px-3 py-2.5 text-right whitespace-nowrap tabular-nums", r.avgFirstTouchMs === null && "text-zinc-400")}>{formatDuration(r.avgFirstTouchMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={report.page} pageCount={report.pageCount} total={report.total} params={params} />
        <p className="text-[11px] text-zinc-500">
          Calls and call minutes are not available: uploaded call recordings are not counted as calls unless the client confirms that rule. Leads are counted under their current owner, on their original assignment date.
        </p>
        <p className="text-[11px] text-zinc-500">
          CRM sign-ins and sign-outs are authentication activity only. They are not attendance and are not used to work out hours, lateness or absences;
          attendance is not available until the client approves its rules. {retentionNote}
        </p>
      </Panel>
    </PageStack>
  );
}
