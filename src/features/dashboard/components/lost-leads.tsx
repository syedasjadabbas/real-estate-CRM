import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress";
import { formatInt, percentOf } from "@/lib/format";
import type { LostBreakdown } from "../types";

/**
 * FR-016: lost leads (created in the selected range and now Lost) by reason and by team. A reason
 * opens the Lost list filtered to it for the same days; a team expands to its agents.
 */
export function LostLeads({ data }: { data: LostBreakdown | null }) {
  const maxReason = Math.max(1, ...(data?.byReason.map((r) => r.count) ?? [1]));
  const maxTeam = Math.max(1, ...(data?.byTeam.map((t) => t.count) ?? [1]));
  const reasonHref = (id: string) => {
    const p = new URLSearchParams({ from: data!.from, to: data!.to, lostReason: id });
    return `/dashboard/leads/lost?${p.toString()}`;
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Card className="overflow-hidden">
        <CardHeader title="Lost leads by reason" badge={<Badge bordered={false}>Attrition</Badge>} description="Leads created in the selected range that are now lost. Open a reason to see those leads." />
        <div className="space-y-1.5 p-4">
          {!data ? (
            <EmptyState>No lead analytics for your role.</EmptyState>
          ) : data.byReason.length === 0 ? (
            <EmptyState>No lost leads in this range.</EmptyState>
          ) : (
            data.byReason.map((r) => {
              const body = (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs leading-4 font-bold text-zinc-900">{r.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="text-xs font-black tabular-nums">{formatInt(r.count)}</span>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] leading-[15px] font-bold text-zinc-600">{percentOf(r.count, data.total)}%</span>
                    </span>
                  </div>
                  <ProgressBar className="mt-2" size="xs" value={r.count} max={maxReason} label={`${r.label} lost leads`} />
                </>
              );
              const cls = "block rounded-xl border border-zinc-200/80 bg-white px-2.5 py-2 shadow-hairline";
              // The Lost list cannot filter for "no reason", so that row is not a link.
              return r.id === "none" ? (
                <div key={r.id} className={cls}>
                  {body}
                </div>
              ) : (
                <Link key={r.id} href={reasonHref(r.id)} className={`${cls} transition-colors hover:border-rose-200 hover:bg-rose-50/30`}>
                  {body}
                </Link>
              );
            })
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Lost leads by team" badge={<Badge bordered={false}>Teams</Badge>} description="By the owner's team. Owners in several teams count under each; open a team to see its agents." />
        <div className="space-y-1.5 p-4">
          {!data ? (
            <EmptyState>No lead analytics for your role.</EmptyState>
          ) : data.byTeam.length === 0 ? (
            <EmptyState>No lost leads in this range.</EmptyState>
          ) : (
            data.byTeam.map((t) => (
              <details key={t.id} className="group rounded-xl border border-zinc-200/80 bg-white px-2.5 py-2 shadow-hairline">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
                    <span className="truncate text-xs leading-4 font-bold text-zinc-900">{t.label}</span>
                  </span>
                  <span className="text-xs font-black tabular-nums">{formatInt(t.count)}</span>
                </summary>
                <ProgressBar className="mt-2" size="xs" value={t.count} max={maxTeam} label={`${t.label} lost leads`} />
                <ul className="mt-2 space-y-1 border-t border-zinc-100 pt-2">
                  {t.agents.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-zinc-700">{a.label}</span>
                      <span className="font-bold tabular-nums">{formatInt(a.count)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
