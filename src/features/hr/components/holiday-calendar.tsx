import { cn } from "@/lib/cn";
import type { HolidayRow } from "@/modules/holidays/service";
import { HOLIDAY_SCOPE_LABELS } from "@/modules/holidays/validation";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthName = (month: number) => new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, month, 1)));
const pad = (n: number) => String(n).padStart(2, "0");

/** Twelve month grids for the year (weeks start Monday); holiday dates are highlighted and listed under each month. */
export function HolidayCalendar({ year, rows, today }: { year: number; rows: HolidayRow[]; today: string }) {
  const byDate = new Map<string, HolidayRow[]>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 12 }, (_, m) => {
        const days = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
        const lead = (new Date(Date.UTC(year, m, 1)).getUTCDay() + 6) % 7;
        const monthRows = rows.filter((r) => r.date.startsWith(`${year}-${pad(m + 1)}`)).sort((a, b) => a.date.localeCompare(b.date));
        return (
          <section key={m} aria-label={`${monthName(m)} ${year}`} className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-hairline">
            <h3 className="mb-2 flex items-baseline justify-between text-sm font-black">
              {monthName(m)}
              <span className="text-[10px] font-bold text-zinc-500">
                {monthRows.length ? `${monthRows.length} ${monthRows.length === 1 ? "holiday" : "holidays"}` : ""}
              </span>
            </h3>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]" role="presentation">
              {WEEKDAYS.map((d) => (
                <span key={d} className="py-1 text-[9px] font-black tracking-[0.05em] text-zinc-400 uppercase" aria-hidden="true">
                  {d.slice(0, 2)}
                </span>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <span key={`b${i}`} aria-hidden="true" />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const date = `${year}-${pad(m + 1)}-${pad(i + 1)}`;
                const hits = byDate.get(date);
                return (
                  <span
                    key={date}
                    title={hits?.map((h) => h.name).join(", ")}
                    aria-label={hits ? `${i + 1} ${monthName(m)}: ${hits.map((h) => h.name).join(", ")}` : undefined}
                    aria-hidden={hits ? undefined : true}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-lg font-semibold tabular-nums",
                      hits ? (hits.some((h) => h.scope === "company") ? "bg-brand font-black text-white" : "bg-sky-100 font-black text-sky-800") : "text-zinc-700",
                      date === today && "ring-2 ring-zinc-900/70",
                    )}
                  >
                    {i + 1}
                  </span>
                );
              })}
            </div>
            {monthRows.length ? (
              <ul className="mt-3 space-y-1 border-t border-zinc-100 pt-2 text-[11px]">
                {monthRows.map((r) => (
                  <li key={r.id} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words">
                      <span className="font-black tabular-nums">{Number(r.date.slice(8))}</span> <span className="font-semibold">{r.name}</span>
                    </span>
                    <span className="shrink-0 text-zinc-500">{r.region ?? HOLIDAY_SCOPE_LABELS[r.scope]}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
