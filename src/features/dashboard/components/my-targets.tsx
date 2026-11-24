import { Card, Eyebrow } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress";
import { formatInt } from "@/lib/format";
import type { TargetLine, TargetPeriods } from "../types";

/** "10 Nov" for "2026-11-10". */
function shortDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

/** One goal, in words: how much is done of what was asked, and what is still to go. */
function TargetRow({ line }: { line: TargetLine }) {
  const { actual } = line;
  const target = line.target ?? 0;
  const left = target - actual;
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white px-3 py-2.5 shadow-hairline">
      <p className="text-xs leading-4 font-bold">{line.label}</p>
      <p className="mt-1 text-sm leading-5 tabular-nums">
        <span className="font-black">{formatInt(actual)}</span>
        <span className="text-zinc-600"> of {formatInt(target)} done</span>
      </p>
      <ProgressBar className="mt-1.5" value={actual} max={target} label={`${line.label} progress`} />
      <p className={left > 0 ? "mt-1.5 text-[11px] leading-4 font-semibold text-zinc-600 tabular-nums" : "mt-1.5 text-[11px] leading-4 font-black text-brand"}>
        {left > 0 ? `${formatInt(left)} more to go` : "✓ Target met"}
      </p>
    </div>
  );
}

function TargetColumn({ title, lines }: { title: string; lines: TargetLine[] }) {
  const set = lines.filter((l) => l.target);
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/50 p-2.5">
      <p className="px-1 pb-2 text-[10px] font-black tracking-[0.1em] text-zinc-600 uppercase">{title}</p>
      {set.length ? (
        <div className="space-y-2">
          {set.map((line) => (
            <TargetRow key={line.label} line={line} />
          ))}
        </div>
      ) : (
        <p className="px-1 pb-1 text-xs text-zinc-500">No target set.</p>
      )}
    </div>
  );
}

/** An agent's targets against their activity, right under Executive Essentials (client, 23 Nov 2026). */
export function MyTargets({ targets }: { targets: TargetPeriods | null }) {
  const columns = targets
    ? [
        { title: "Today", lines: targets.today },
        { title: "This week", lines: targets.week },
        { title: "This month", lines: targets.month },
        // Custom-period targets running today (15 Nov 2026).
        ...(targets.custom ?? []).map((c) => ({ title: `Special target · ${shortDate(c.start)} – ${shortDate(c.end)}`, lines: c.lines })),
      ]
    : [];
  const anyTarget = columns.some((c) => c.lines.some((l) => l.target));
  return (
    <Card className="p-4">
      <Eyebrow className="text-xs leading-4">My Targets</Eyebrow>
      <p className="mt-0.5 text-[11px] text-zinc-600">What your Admin asked you to achieve, and how much you have done so far.</p>
      {anyTarget ? null : (
        <EmptyState size="sm" className="mt-3">
          No targets are set for you yet. Your Admin sets them in Targets.
        </EmptyState>
      )}
      {anyTarget ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {columns.map((c) => (
            <TargetColumn key={c.title} title={c.title} lines={c.lines} />
          ))}
        </div>
      ) : null}
    </Card>
  );
}
