import { cn } from "@/lib/cn";

/** Thin rounded progress track with the brand gradient fill. */
export function ProgressBar({
  value,
  max = 100,
  size = "sm",
  className,
  label,
}: {
  value: number;
  max?: number;
  size?: "xs" | "sm" | "md";
  className?: string;
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn(
        "w-full overflow-hidden rounded-full bg-zinc-100",
        size === "xs" ? "h-1" : size === "sm" ? "h-1.5" : "h-2",
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-linear-to-r from-brand to-brand-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export type Segment = { value: number; className: string; label: string };

/** Stacked bar (open / won / lost split on the Total leads card). */
export function StackedBar({ segments, className }: { segments: Segment[]; className?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className={cn("flex h-2 w-full overflow-hidden rounded-full bg-zinc-100", className)}>
      {total > 0
        ? segments.map((s) => (
            <span
              key={s.label}
              title={s.label}
              className={cn("h-full", s.className)}
              style={{ width: `${(s.value / total) * 100}%` }}
            />
          ))
        : null}
    </div>
  );
}
