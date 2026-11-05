"use client";

import { ArrowRight, Inbox, RefreshCw, TrendingUp, Activity, CircleCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, Eyebrow } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar, StackedBar } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented";
import { KpiCard } from "@/components/ui/stat";
import { formatCompact, formatInt, formatPct, formatTime, NO_VALUE } from "@/lib/format";
import { LEAD_STAGES } from "@/modules/leads/constants";
import type { DashboardData, DashboardFilters, RangeKey } from "../types";
import { rangeOptions } from "./range-options";

/** Stages the Open pipeline tile counts: everything but Booked and Lost. */
const OPEN_STAGES = LEAD_STAGES.filter((s) => s !== "booked" && s !== "lost_lead").join(",");

function SplitLegend({ open, won, lost }: { open: number | null; won: number | null; lost: number | null }) {
  const items = [
    { label: "Open", value: open, className: "text-amber-600", align: "text-left" },
    { label: "Won", value: won, className: "text-brand", align: "text-center" },
    { label: "Lost", value: lost, className: "text-rose-600", align: "text-right" },
  ];
  return (
    <div>
      <StackedBar
        segments={[
          { label: "Open", value: open ?? 0, className: "bg-amber-400" },
          { label: "Won", value: won ?? 0, className: "bg-brand" },
          { label: "Lost", value: lost ?? 0, className: "bg-rose-500" },
        ]}
      />
      <dl className="mt-1.5 grid grid-cols-3 text-[11px] leading-[13.75px] font-black tabular-nums">
        {items.map((item) => (
          <div key={item.label} className={item.align}>
            <dd className={item.className}>{formatPct(item.value)}</dd>
            <dt className="text-[9px] leading-[11.25px] font-bold tracking-[0.05em] text-zinc-400 uppercase">
              {item.label}
            </dt>
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

export function ExecutiveEssentials({ data, filters = { range: "mtd" } }: { data: DashboardData; filters?: DashboardFilters }) {
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
  const maxProject = Math.max(1, ...data.topProjects.map((p) => p.count));
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
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            icon={Inbox}
            category="Pipeline"
            label="Total leads"
            href={listHref("/dashboard/leads")}
            linkLabel="Open the leads list for these days"
            value={formatCompact(kpis?.totalLeads)}
            caption="Active portfolio leads"
            footer={
              <SplitLegend open={kpis?.openPct ?? null} won={kpis?.wonPct ?? null} lost={kpis?.lostPct ?? null} />
            }
          />
          <KpiCard
            icon={Activity}
            category="Performance"
            label="Conversion rate"
            value={<span className="text-brand">{formatPct(kpis?.conversionRate)}</span>}
            caption={`Win on decided: ${formatPct(kpis?.winOnDecided)}`}
          />
          <KpiCard
            icon={TrendingUp}
            tone="amber"
            category="In progress"
            label="Open pipeline"
            href={listHref("/dashboard/leads", { stage: OPEN_STAGES })}
            linkLabel="Open the leads still in progress for these days"
            value={<span className="text-amber-800">{formatCompact(kpis?.openPipeline)}</span>}
            caption={`${formatPct(kpis?.openPipelinePct)} still active`}
          />
          <KpiCard
            icon={CircleCheck}
            tone="neutral"
            category="Outcomes"
            label="Won / Lost"
            href={listHref("/dashboard/leads/won")}
            linkLabel="Open won leads for these days"
            value={
              <>
                <span className="text-brand">{formatInt(kpis?.won)}</span>
                <span className="mx-1 text-zinc-300">/</span>
                <span className="text-rose-600">{formatInt(kpis?.lost)}</span>
              </>
            }
            caption={`${formatPct(kpis?.attritionPct)} attrition rate`}
          />
          <KpiCard
            icon={RefreshCw}
            tone="sky"
            category="Re-inquiries"
            label="Regenerated"
            href={listHref("/dashboard/leads/regenerated")}
            linkLabel="Open regenerated leads for these days"
            value={<span className="text-sky-800">{formatInt(kpis?.regenerated)}</span>}
            caption={`${kpis ? formatInt(kpis.awaitingFirstTouch) : NO_VALUE} awaiting first touch`}
          />
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
          {data.teams.length === 0 ? <p className="mt-3 text-sm text-zinc-600">No teams in your scope.</p> : null}
          {pending ? <p role="status" className="mt-2 text-xs font-semibold text-zinc-500">Updating…</p> : null}
        </div>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <Card className="p-5">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <Eyebrow>Organization Health</Eyebrow>
              <Badge tone="neutral" className="px-2.5">
                Active
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Link
                href="/dashboard/projects"
                className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 transition-colors hover:bg-zinc-50"
              >
                <p className="text-[10px] leading-[15px] font-black tracking-[0.05em] text-zinc-400 uppercase">
                  Projects
                </p>
                <p className="text-2xl leading-8 font-black tabular-nums">{formatInt(data.activeProjects)}</p>
              </Link>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <Eyebrow>Top Projects · Lead Volume</Eyebrow>
              <Link
                href="/dashboard/leads"
                className="inline-flex items-center gap-1 text-[10px] font-black tracking-[0.1em] text-zinc-600 uppercase hover:text-brand"
              >
                All leads <ArrowRight aria-hidden="true" className="size-3" />
              </Link>
            </div>
            <div className="mt-3 space-y-2">
              {data.topProjects.length === 0 ? (
                <EmptyState size="sm">No project lead volume yet.</EmptyState>
              ) : (
                data.topProjects.map((project, index) => (
                  <div key={project.id} className="rounded-xl border border-zinc-200/80 px-2.5 py-2 shadow-hairline">
                    <div className="flex items-center justify-between gap-2 text-xs leading-4">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[9px] font-black text-brand">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="truncate font-bold">{project.label}</span>
                      </span>
                      <span className="shrink-0 font-black tabular-nums">{formatCompact(project.count)} leads</span>
                    </div>
                    <ProgressBar value={project.count} max={maxProject} className="mt-2" label={project.label} />
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
