import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";

const SEGMENTS = [
  { key: "open", label: "Open leads", stroke: "stroke-zinc-400", dot: "bg-zinc-400" },
  { key: "booked", label: "Booked", stroke: "stroke-brand", dot: "bg-brand" },
  { key: "lost", label: "Lost", stroke: "stroke-rose-500", dot: "bg-rose-500" },
] as const;

/** Observed "Outcome mix": open pipeline vs booked vs lost in range, with win rate on decided leads. */
export function OutcomeMix({ mix, winPct }: { mix: { open: number; booked: number; lost: number; total: number }; winPct: number | null }) {
  const radius = 15.9155; // circumference = 100
  const pcts = SEGMENTS.map((s) => (mix.total ? (mix[s.key] / mix.total) * 100 : 0));
  const parts = SEGMENTS.map((s, i) => ({ ...s, count: mix[s.key], pct: pcts[i], start: pcts.slice(0, i).reduce((a, b) => a + b, 0) }));
  return (
    <Panel title="Outcome mix" badge={<Badge>Pipeline</Badge>} description="Open pipeline vs booked vs lost in range">
      {mix.total === 0 ? (
        <EmptyState size="sm">No leads assigned in this range.</EmptyState>
      ) : (
        <div className="flex flex-wrap items-center gap-6 py-2">
          <figure className="relative size-36 shrink-0" aria-label={`${mix.total} leads: ${parts.map((p) => `${p.label} ${p.count}`).join(", ")}`}>
            <svg viewBox="0 0 42 42" className="size-full -rotate-90">
              <circle cx="21" cy="21" r={radius} fill="none" className="stroke-zinc-100" strokeWidth="6" />
              {parts
                .filter((p) => p.pct > 0)
                .map((p) => (
                  <circle
                    key={p.key}
                    cx="21"
                    cy="21"
                    r={radius}
                    fill="none"
                    strokeWidth="6"
                    className={p.stroke}
                    strokeDasharray={`${Math.max(0, p.pct - (p.pct < 100 ? 0.8 : 0))} ${100 - p.pct}`}
                    strokeDashoffset={-p.start}
                  />
                ))}
            </svg>
            <figcaption className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-black tabular-nums">{formatInt(mix.total)}</span>
              <span className="text-[9px] font-black tracking-[0.1em] text-zinc-400 uppercase">Outcomes</span>
            </figcaption>
          </figure>
          <ul className="min-w-[160px] flex-1 space-y-2 text-xs">
            {parts.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-semibold">
                  <span className={cn("size-2.5 rounded-full", p.dot)} aria-hidden="true" />
                  {p.label}
                </span>
                <span className="font-black tabular-nums">
                  {formatInt(p.count)} <span className="font-semibold text-zinc-400">{Math.round(p.pct)}%</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="pb-1 text-[11px] text-zinc-500">Win rate on decided leads: {winPct === null ? "—" : `${winPct}%`}.</p>
    </Panel>
  );
}

/** Observed "Top closers": bookings closed in the selected range. */
export function TopClosers({ rows }: { rows: { userId: string; name: string; booked: number; winPct: number | null }[] }) {
  return (
    <Panel title="Top closers" badge={<Badge tone="neutral">Rank</Badge>} description="Bookings closed in selected range">
      {rows.length === 0 ? (
        <EmptyState size="sm">No bookings in this range.</EmptyState>
      ) : (
        <ol className="space-y-1.5 py-1">
          {rows.map((r, i) => (
            <li key={r.userId} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
              <span className="flex min-w-0 items-center gap-2">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[11px] font-black text-brand-700">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate font-bold">{r.name}</span>
                  <span className="block text-[11px] text-zinc-500">Win {r.winPct === null ? "—" : `${r.winPct}%`}</span>
                </span>
              </span>
              <span className="text-base font-black tabular-nums">{formatInt(r.booked)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** Reference charts that need calls, which aren't available until recordings are confirmed to count as calls (FR-152, C-19). */
export function NeedsCallData({ title, badge, description }: { title: string; badge: string; description: string }) {
  return (
    <Panel title={title} badge={<Badge tone="neutral">{badge}</Badge>} description={description}>
      <EmptyState size="sm">Not available: uploaded call recordings are not counted as calls unless the client confirms that rule.</EmptyState>
    </Panel>
  );
}
