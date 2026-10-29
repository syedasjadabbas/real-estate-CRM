import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress";
import { SummaryTile } from "@/components/ui/stat";
import { cn } from "@/lib/cn";
import { formatInt, NO_VALUE, percentOf } from "@/lib/format";
import type { NamedCount } from "../types";

/** Rank chip colours: 1st amber, 2nd silver, 3rd green, the rest muted. */
const rankStyles = [
  "border border-amber-300 bg-amber-50 text-amber-900",
  "border border-zinc-300 bg-zinc-100 text-zinc-800",
  "border border-brand/25 bg-brand-50 text-brand",
];

/** Ranked volume list ("Lead sources", "Inbound channels"). */
export function DistributionCard({
  title,
  badge,
  description,
  rows,
  emptyMessage,
}: {
  title: string;
  badge: string;
  description: string;
  rows: NamedCount[];
  emptyMessage: string;
}) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.count));
  const top = rows[0];
  const active = rows.filter((r) => r.count > 0).length;

  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} badge={<Badge bordered={false}>{badge}</Badge>} description={description} />
      <div className="px-4 pt-3">
        <div className="grid grid-cols-3 gap-2">
          <SummaryTile label="Total" value={total ? formatInt(total) : NO_VALUE} />
          <SummaryTile label="Top" value={top?.label ?? NO_VALUE} accent />
          <SummaryTile
            label="Active"
            value={
              <>
                {rows.length ? active : NO_VALUE}
                <span className="text-xs font-medium text-zinc-400">/{rows.length || NO_VALUE}</span>
              </>
            }
          />
        </div>
      </div>
      <div className="space-y-1.5 p-4">
        {rows.length === 0 ? (
          <EmptyState>{emptyMessage}</EmptyState>
        ) : (
          rows.map((row, index) => (
            <div key={row.id} className="rounded-xl border border-zinc-200/80 bg-white px-2.5 py-2 shadow-hairline">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[9px] font-black",
                      rankStyles[index] ?? "bg-zinc-50 text-zinc-400",
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="truncate text-xs leading-4 font-bold text-zinc-900">{row.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-xs font-black tabular-nums">{formatInt(row.count)}</span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] leading-[15px] font-bold text-zinc-600">
                    {percentOf(row.count, total)}%
                  </span>
                </span>
              </div>
              <ProgressBar className="mt-2" size="xs" value={row.count} max={max} label={`${row.label} volume`} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
