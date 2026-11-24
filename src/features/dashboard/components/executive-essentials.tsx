"use client";

import { AlarmClock, Building2, CircleCheck, Gauge, Inbox, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ProgressBar, StackedBar } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented";
import { KpiCard } from "@/components/ui/stat";
import { formatCompact, formatInt, formatPct, formatTime, NO_VALUE } from "@/lib/format";
import { LEAD_STAGES } from "@/modules/leads/constants";
import type { DashboardData, DashboardFilters, RangeKey } from "../types";
import { rangeOptions } from "./range-options";

/** Stages the Open pipeline tile counts: everything but Booked and Lost. */
const OPEN_STAGES = LEAD_STAGES.filter((s) => s !== "booked" && s !== "lost_lead").join(",");

/** Won, lost and open as numbers, so the conversion rate reads with what it is made of. */
function OutcomeLegend({ open, won, lost }: { open: number; won: number; lost: number }) {
  const items = [
    { label: "Won", value: won, className: "text-brand", bar: "bg-brand", align: "text-left" },
    { label: "Lost", value: lost, className: "text-rose-600", bar: "bg-rose-500", align: "text-center" },
    { label: "Open", value: open, className: "text-amber-600", bar: "bg-amber-400", align: "text-right" },
  ];
  return (
    <div>
      <StackedBar segments={items.map((i) => ({ label: i.label, value: i.value, className: i.bar }))} />
      <dl className="mt-1.5 grid grid-cols-3 text-[11px] leading-[13.75px] font-black tabular-nums">
        {items.map((item) => (
          <div key={item.label} className={item.align}>
            <dd className={item.className}>{formatInt(item.value)}</dd>
            <dt className="text-[9px] leading-[11.25px] font-bold tracking-[0.05em] text-zinc-400 uppercase">{item.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Builds the dashboard URL for a filter change; "all" teams and the default range leave no parameter. */
function dashboardHref(next: DashboardFilters) {
  const p = new URLSearchParams();
  if (next.range !== "mtd") p.set("range", next.range);
  if (next.range === "custom" && next.from) p.set("from", next.from);
  if (next.range === "custom" && next.to) p.set("to", next.to);
  if (next.team) p.set("team", next.team);
  const q = p.toString();
  return q ? `/dashboard?${q}` : "/dashboard";
}

/** `own`: an agent's dashboard (their own leads only; no organisation-wide figures). */
export function ExecutiveEssentials({ data, filters = { range: "mtd" }, own = false }: { data: DashboardData; filters?: DashboardFilters; own?: boolean }) {
  const { kpis } = data;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const team = filters.team ?? "all";
  const range = filters.range;
  const [customOpen, setCustomOpen] = useState(range === "custom");
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const go = (next: DashboardFilters) => startTransition(() => router.push(dashboardHref(next), { scroll: false }));
  const setTeam = (id: string) => go({ ...filters, team: id === "all" ? undefined : id });
  const setRange = (value: RangeKey) => {
    if (value === "custom") return setCustomOpen(true);
    setCustomOpen(false);
    go({ range: value, team: filters.team });
  };
  const ownScore = data.scoreScope === "own" ? data.teamScores[0] : undefined;
  // KPI tiles open the matching list: the same leads, window and team (MODULES_AND_FEATURES §1, FR-010).
  const listHref = (path: string, extra: Record<string, string> = {}) => {
    if (data.isSample) return undefined;
    const query = new URLSearchParams({ ...data.listParams, ...extra }).toString();
    return query ? `${path}?${query}` : path;
  };

  return (
    <section aria-labelledby="exec-title">
      <div className="flex items-center justify-between gap-2">
        <p id="exec-title" className="text-xs leading-4 font-black tracking-[0.2em] text-zinc-600 uppercase">
          Executive Essentials
        </p>
        <span className="text-[10px] leading-[15px] font-bold tracking-[0.05em] text-zinc-400 uppercase">
          {data.snapshotAt ? `Snapshot: ${formatTime(data.snapshotAt)}` : "No snapshot yet"}
        </span>
      </div>

      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-5 [&>*:last-child]:sm:col-span-2 [&>*:last-child]:xl:col-span-1">
          <KpiCard
            icon={Inbox}
            category="Pipeline"
            label="Total leads"
            href={listHref("/dashboard/leads")}
            linkLabel="Open the leads list for these days"
            value={formatCompact(kpis?.totalLeads)}
            caption={`${kpis ? formatInt(kpis.awaitingFirstTouch) : NO_VALUE} awaiting first touch`}
          />
          {/* Conversion and Outcomes are one box, with the numbers behind the rate (client, 23 Nov 2026). */}
          <KpiCard
            icon={CircleCheck}
            category="Outcomes"
            label="Conversion"
            href={listHref("/dashboard/leads/won")}
            linkLabel="Open won leads for these days"
            value={<span className="text-brand">{formatPct(kpis?.conversionRate)}</span>}
            caption={kpis ? `${formatInt(kpis.won)} won of ${formatInt(kpis.totalLeads)} leads` : NO_VALUE}
            footer={kpis ? <OutcomeLegend open={kpis.openPipeline} won={kpis.won} lost={kpis.lost} /> : undefined}
          />
          <KpiCard
            icon={TrendingUp}
            tone="amber"
            category="In progress"
            label="Open pipeline"
            href={listHref("/dashboard/leads", { stage: OPEN_STAGES })}
            linkLabel="Open the leads still in progress for these days"
            value={<span className="text-amber-800">{formatCompact(kpis?.openPipeline)}</span>}
            caption="Leads not yet won or lost"
          />
          <KpiCard
            icon={AlarmClock}
            tone="rose"
            category="Action now"
            label="Overdue follow-ups"
            href={data.followUps && !data.isSample ? "/dashboard/leads/todos?bucket=overdue" : undefined}
            linkLabel="Open overdue follow-ups"
            value={<span className="text-rose-600">{formatInt(data.followUps?.overdue)}</span>}
            caption={`${data.followUps ? formatInt(data.followUps.today) : NO_VALUE} due today`}
          />
          {own ? (
            <KpiCard
              icon={Gauge}
              category="Score"
              label="Your performance score"
              href={ownScore && !data.isSample ? "/dashboard/performance" : undefined}
              linkLabel="Open my performance"
              value={formatInt(ownScore?.count)}
              caption={ownScore?.provisional ? "Out of 100 · provisional while your history is small" : "Out of 100"}
              footer={ownScore ? <ProgressBar value={ownScore.count} max={100} label="Your score" /> : undefined}
            />
          ) : (
            <KpiCard
              icon={Building2}
              tone="neutral"
              category="Organization"
              label="Active projects"
              href="/dashboard/projects"
              linkLabel="Open projects"
              value={formatInt(data.activeProjects)}
              caption="Projects open for leads"
            />
          )}
        </div>

        <div>
          <div className="flex flex-col gap-2 md:flex-row">
            <nav
              aria-label="Team scope"
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-2xl border border-zinc-200/80 bg-white p-1.5 shadow-hairline"
            >
              {[...data.teams, { id: "all", name: "All teams" }].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={team === t.id}
                  onClick={() => setTeam(t.id)}
                  className={
                    team === t.id
                      ? "rounded-xl bg-brand px-3.5 py-2 text-xs leading-4 font-bold text-white shadow-hairline"
                      : "rounded-xl px-3.5 py-2 text-xs leading-4 font-bold text-zinc-700 hover:bg-zinc-100"
                  }
                >
                  {t.name}
                </button>
              ))}
            </nav>
            <SegmentedControl label="Date range" options={rangeOptions} value={customOpen ? "custom" : range} onChange={setRange} />
          </div>
          {customOpen ? (
            <form
              className="mt-2 flex flex-wrap items-end gap-2 rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-hairline"
              onSubmit={(e) => {
                e.preventDefault();
                if (from && to && from <= to) go({ range: "custom", from, to, team: filters.team });
              }}
            >
              <label className="text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">
                From
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1 block h-9 rounded-xl border border-zinc-200/80 px-2 text-xs font-semibold text-zinc-900" />
              </label>
              <label className="text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">
                To
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 block h-9 rounded-xl border border-zinc-200/80 px-2 text-xs font-semibold text-zinc-900" />
              </label>
              <button type="submit" disabled={!from || !to || from > to || pending} className="h-9 rounded-xl bg-brand px-3.5 text-xs font-bold text-white shadow-hairline disabled:opacity-50">
                Apply
              </button>
              {from && to && from > to ? <p className="text-xs font-semibold text-rose-600">The start date must be on or before the end date.</p> : null}
            </form>
          ) : null}
          {data.teams.length === 0 && !own ? <p className="mt-3 text-sm text-zinc-600">No teams in your scope.</p> : null}
          {pending ? <p role="status" className="mt-2 text-xs font-semibold text-zinc-500">Updating…</p> : null}
        </div>
      </div>
    </section>
  );
}
