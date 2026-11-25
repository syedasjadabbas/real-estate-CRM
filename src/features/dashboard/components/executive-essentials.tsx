"use client";

import { AlarmClock, Building2, CircleCheck, Gauge, Hourglass, Inbox, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ProgressBar, StackedBar } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented";
import { KpiCard } from "@/components/ui/stat";
import { formatCompact, formatInt, formatPct, formatTime, NO_VALUE } from "@/lib/format";
import { IN_PROGRESS_STAGES, STAGNATING_DAYS } from "@/modules/leads/constants";
import type { DashboardData, DashboardFilters, RangeKey } from "../types";
import { rangeOptions } from "./range-options";

/** Won and lost as numbers, so the conversion rate reads with what it is made of. */
function OutcomeLegend({ won, lost }: { won: number; lost: number }) {
  const items = [
    { label: "Won", value: won, className: "text-brand", bar: "bg-brand", align: "text-left" },
    { label: "Lost", value: lost, className: "text-rose-600", bar: "bg-rose-500", align: "text-right" },
  ];
  return (
    <div>
      <StackedBar segments={items.map((i) => ({ label: i.label, value: i.value, className: i.bar }))} />
      <dl className="mt-1.5 grid grid-cols-2 text-[11px] leading-[13.75px] font-black tabular-nums">
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
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          <KpiCard
            icon={Inbox}
            category="Pipeline"
            label="Total leads"
            href={listHref("/dashboard/leads")}
            linkLabel="Open the leads list for these days"
            value={formatCompact(kpis?.totalLeads)}
            caption={`${kpis ? formatInt(kpis.awaitingFirstTouch) : NO_VALUE} awaiting first touch`}
            footer={
              kpis ? (
                <div>
                  <p className="flex items-baseline justify-between gap-2 text-[11px] font-bold text-zinc-700">
                    Open pipeline
                    <span data-kpi-open className="text-sm font-black text-amber-800 tabular-nums">{formatPct(kpis.openPipelinePct)}</span>
                  </p>
                  <ProgressBar value={kpis.openPipelinePct} max={100} label="Open pipeline" />
                  <p className="mt-1 text-[10px] text-zinc-500">{formatInt(kpis.openPipeline)} opened, contact attempted or contacted</p>
                </div>
              ) : undefined
            }
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
            footer={kpis ? <OutcomeLegend won={kpis.won} lost={kpis.lost} /> : undefined}
          />
          <KpiCard
            icon={TrendingUp}
            tone="amber"
            category="In progress"
            label="Qualified rate"
            href={listHref("/dashboard/leads", { stage: IN_PROGRESS_STAGES.join(",") })}
            linkLabel="Open the leads from Qualified to Booking in Process"
            value={<span className="text-amber-800">{formatPct(kpis?.qualifiedRate)}</span>}
            caption={kpis ? `${formatInt(kpis.qualified)} from Qualified to Booking in Process` : NO_VALUE}
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
          <KpiCard
            icon={Hourglass}
            tone="rose"
            category="Action now"
            label="Stagnating"
            href={data.isSample ? undefined : "/dashboard/leads/stagnating"}
            linkLabel="Open stagnating leads"
            value={<span className="text-rose-600">{formatInt(data.stagnating)}</span>}
            caption={`${STAGNATING_DAYS} days or more in one stage`}
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
