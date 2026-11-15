import { EmptyState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { formatListedOn } from "@/features/inventory/format";
import { cn } from "@/lib/cn";
import { ROSTER_STATUSES, ROSTER_STATUS_LABELS, type RosterStatus } from "@/modules/teams/validation";

const SHORT: Record<RosterStatus, string> = { in_office: "IO", on_site: "OS", on_leave: "L", leads_off: "OFF" };
const TONE: Record<RosterStatus, string> = {
  in_office: "bg-brand-50 text-brand-700",
  on_site: "bg-sky-50 text-sky-800",
  on_leave: "bg-amber-50 text-amber-800",
  leads_off: "bg-rose-50 text-rose-700",
};

export function RosterLegend() {
  return (
    <p className="flex flex-wrap gap-2 text-[11px] text-zinc-600">
      {ROSTER_STATUSES.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-black", TONE[s])}>{SHORT[s]}</span>
          {ROSTER_STATUS_LABELS[s]}
        </span>
      ))}
    </p>
  );
}

/** FR-122 Month view: members × days (read-only; changes are made in the Day view). */
/** Day of week (0 = Sunday) of a "YYYY-MM-DD" date, independent of the browser's time zone. */
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export function RosterMonthGrid({
  days,
  rows,
  weekendDays = [],
  dayHref,
}: {
  days: string[];
  rows: { id: string; name: string; byDay: Record<string, RosterStatus> }[];
  weekendDays?: number[];
  /** Opens that day for editing (15 Nov 2026). */
  dayHref?: (date: string) => string;
}) {
  const weekend = (d: string) => weekendDays.includes(weekdayOf(d));
  if (rows.length === 0) return <EmptyState size="sm">This team has no members.</EmptyState>;
  return (
    <div className="space-y-2">
      <RosterLegend />
      <p className="text-[11px] text-zinc-500">
        {weekendDays.length ? "Shaded columns are weekly days off. " : ""}
        {dayHref ? "Click a date to open that day." : ""}
      </p>
      <div className="max-h-[480px] overflow-auto rounded-xl border border-zinc-200/80">
        <table className="border-collapse text-left text-[11px]">
          <thead className="sticky top-0 bg-zinc-100">
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-[140px] bg-zinc-100 px-3 py-2 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                Member
              </th>
              {days.map((d) => (
                <th key={d} scope="col" className={cn("w-9 px-1 py-2 text-center font-black tabular-nums", weekend(d) ? "bg-zinc-200/70 text-zinc-500" : "text-zinc-600")} title={weekend(d) ? "Weekly day off" : undefined}>
                  {dayHref ? (
                    <a href={dayHref(d)} className="hover:text-brand hover:underline">
                      {Number(d.slice(8))}
                    </a>
                  ) : (
                    Number(d.slice(8))
                  )}
                </th>
              ))}
              {/* Each person's month at a glance (15 Nov 2026). */}
              {(["in_office", "on_site", "on_leave", "leads_off"] as const).map((s) => (
                <th key={s} scope="col" className="w-10 bg-zinc-100 px-1 py-2 text-center text-[10px] font-black text-zinc-600" title={`Days ${ROSTER_STATUS_LABELS[s]}`}>
                  {SHORT[s]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100">
                <th scope="row" className="sticky left-0 bg-white px-3 py-1.5 font-semibold whitespace-nowrap">
                  {r.name}
                </th>
                {days.map((d) => {
                  const s = r.byDay[d];
                  return (
                    <td key={d} className={cn("px-0.5 py-1 text-center", weekend(d) && "bg-zinc-100/80")} title={s ? `${r.name}: ${ROSTER_STATUS_LABELS[s]} on ${d}` : weekend(d) ? "Weekly day off" : undefined}>
                      {s ? <span className={cn("inline-block rounded px-1 py-0.5 text-[9px] font-black", TONE[s])}>{SHORT[s]}</span> : <span className="text-zinc-300">·</span>}
                    </td>
                  );
                })}
                {(["in_office", "on_site", "on_leave", "leads_off"] as const).map((s) => (
                  <td key={s} className="bg-zinc-50 px-1 py-1 text-center font-black tabular-nums text-zinc-700">
                    {days.filter((d) => r.byDay[d] === s).length}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "R (own roster)": an agent's own duty for the month. */
export function MyRosterList({ entries, counts }: { entries: { date: string; status: RosterStatus; teamName: string }[]; counts: Record<RosterStatus, number> }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ROSTER_STATUSES.map((s) => (
          <MiniStat key={s} label={ROSTER_STATUS_LABELS[s]} value={counts[s]} caption="days this month" />
        ))}
      </div>
      {entries.length === 0 ? (
        <EmptyState size="sm">No duty marked for you this month.</EmptyState>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200/80">
          {entries.map((e) => (
            <li key={e.date} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="font-semibold">{formatListedOn(e.date)}</span>
              <span className="flex items-center gap-2 text-zinc-600">
                {e.teamName}
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-black", TONE[e.status])}>{ROSTER_STATUS_LABELS[e.status]}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
