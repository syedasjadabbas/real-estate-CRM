import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress";
import { findNavItem } from "@/config/navigation";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams } from "@/features/leads/url";
import { TargetEditButton } from "@/features/targets/components/target-edit";
import { DateParam, SegmentParam } from "@/features/teams/components/param-controls";
import { formatInt } from "@/lib/format";
import { TARGET_PERIODS, TARGET_PERIOD_LABELS } from "@/modules/targets/period";
import { canViewTargets } from "@/modules/targets/policy";
import { listTargets } from "@/modules/targets/service";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Targets" };

const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** Observed cell: "achieved / target" and a %, or a plain value when no target is set. */
function Cell({ achieved, target, pct, unavailable }: { achieved: number | null; target: number | null; pct: number | null; unavailable?: ReactNode }) {
  if (target === null) return <span className="text-zinc-500 tabular-nums">{achieved === null ? "—" : num.format(achieved)}</span>;
  return (
    <div className="min-w-[120px] space-y-1">
      <p className="font-semibold tabular-nums">
        {achieved === null ? "—" : num.format(achieved)} <span className="text-zinc-400">/ {num.format(target)}</span>
      </p>
      {pct === null ? (
        <p className="text-[10px] text-zinc-500">{unavailable ?? "—"}</p>
      ) : (
        <div className="flex items-center gap-2">
          <ProgressBar value={Math.min(pct, 100)} className="h-1.5 flex-1" />
          <span className="text-[10px] font-black text-zinc-600 tabular-nums">{pct}%</span>
        </div>
      )}
    </div>
  );
}

export default async function TargetsPage({ searchParams }: PageProps<"/dashboard/targets">) {
  const actor = await requirePageUser();
  const item = findNavItem("/dashboard/targets")!;
  if (!canViewTargets(actor)) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const grid = await listTargets(getDb(), actor, params);
  const query = new URLSearchParams({ period: grid.period, anchor: grid.anchor }).toString();

  return (
    <PageStack>
      <PageHeader title="Targets" description="Goals set for your user for the selected period (daily / weekly / monthly)." icon={item.icon} />
      <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-hairline">
        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SegmentParam params={params} name="period" label="Period" value={grid.period} options={TARGET_PERIODS.map((p) => ({ value: p, label: TARGET_PERIOD_LABELS[p] }))} />
          <DateParam params={params} name="anchor" label="Anchor date" value={grid.anchor} />
          <div>
            <p className="mb-1.5 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Period start</p>
            <p className="flex h-10 items-center text-sm font-bold tabular-nums">{grid.periodStart}</p>
          </div>
          <div>
            {params.period || params.anchor ? (
              <Link href="/dashboard/targets" className={buttonClasses({ variant: "secondary", size: "lg", className: "h-10 px-4 text-xs" })}>
                Clear filters
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-hairline">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3.5">
          <div>
            <h2 className="text-sm leading-5 font-black">Agent targets</h2>
            <p className="text-[11px] font-semibold tracking-[0.05em] text-zinc-500 uppercase">
              {TARGET_PERIOD_LABELS[grid.period]} · {grid.periodStart}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-brand/30 bg-brand-50 px-2.5 py-1 text-[10px] leading-[15px] font-black tracking-[0.05em] text-brand-700 uppercase">
              {formatInt(grid.total)} {grid.total === 1 ? "agent" : "agents"}
            </span>
            <a href={`/api/v1/targets/export?${query}`} className={buttonClasses({ variant: "secondary", className: "h-[33px] px-3 text-xs" })} download>
              <Download aria-hidden="true" className="size-3.5" />
              Export CSV
            </a>
          </div>
        </div>
        {grid.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState>No agents in your scope.</EmptyState>
          </div>
        ) : (
          <div className="max-h-[540px] overflow-auto">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-100">
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  {["Agent", "Calls", "Meetings", "Sold sqft", "Actions"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-4 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r) => (
                  <tr key={r.userId} className="border-b border-zinc-100/80 align-top last:border-b-0 hover:bg-zinc-50/60">
                    <td className="px-3 py-3 font-bold whitespace-nowrap">{r.name}</td>
                    <td className="px-3 py-3">
                      <Cell achieved={r.achieved.calls} target={r.target?.calls ?? null} pct={r.percent?.calls ?? null} />
                    </td>
                    <td className="px-3 py-3">
                      <Cell achieved={r.achieved.meetings} target={r.target?.meetings ?? null} pct={r.percent?.meetings ?? null} />
                    </td>
                    <td className="px-3 py-3">
                      <Cell achieved={r.achieved.soldSqft} target={r.target?.soldSqft ?? null} pct={r.percent?.soldSqft ?? null} />
                    </td>
                    <td className="px-3 py-3">
                      {r.canEdit ? <TargetEditButton key={`${r.userId}-${grid.period}-${grid.periodStart}`} userId={r.userId} name={r.name} period={grid.period} periodStart={grid.periodStart} current={r.target} /> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {grid.pageCount > 1 ? <Pagination page={grid.page} pageCount={grid.pageCount} total={grid.total} params={params} /> : null}
      <p className="text-[11px] text-zinc-500">
        Meetings achieved = completed meetings the agent organized in the period. Sold sq ft = the agent&apos;s bookings confirmed in the period. Calls = call recordings the agent
        uploaded to a lead in the period (one recording = one call; hidden recordings are not counted). Periods use Pakistan time.
      </p>
    </PageStack>
  );
}
