"use client";

import { CalendarDays, Clock, X } from "lucide-react";
import { cn } from "@/lib/cn";

const box =
  "h-10 w-full rounded-xl border border-zinc-200/80 bg-zinc-50/70 text-sm font-medium text-zinc-900 shadow-hairline transition-colors hover:border-zinc-300 focus:border-brand/50 focus:bg-white focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";

/** "HH:MM" → "9:15 AM". */
export function timeLabel(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

const QUICK = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In 2 days", days: 2 },
  { label: "Next week", days: 7 },
] as const;

/**
 * Date and time picker (owner, 14 Nov 2026), replacing the browser's datetime box: a date field,
 * hour / minute / AM-PM lists (any exact minute), and quick days. The value keeps the datetime-local format
 * ("YYYY-MM-DDTHH:MM", Pakistan time on the user's clock) so forms and servers are unchanged.
 */
export function DateTimeInput({
  id,
  describedBy,
  value,
  onChange,
  disabled,
  invalid,
  clearable,
  defaultTime = "10:00",
  quick = true,
}: {
  id: string;
  describedBy?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Shows a Clear button (for optional dates). */
  clearable?: boolean;
  /** Time used when only a day is picked. */
  defaultTime?: string;
  /** Show Today / Tomorrow / In 2 days / Next week. */
  quick?: boolean;
}) {
  const [date, time] = value ? [value.slice(0, 10), value.slice(11, 16)] : ["", ""];
  const today = localDate(new Date());
  // Any exact minute (owner, 14 Nov 2026): hour 1–12, minute 00–59, AM / PM.
  const [h24, min] = time ? time.split(":").map(Number) : [null, null];
  const hour12 = h24 === null ? "" : String(h24 % 12 === 0 ? 12 : h24 % 12);
  const minute = min === null ? "" : pad(min);
  const ampm = h24 === null ? "" : h24 < 12 ? "AM" : "PM";
  const [defH, defM] = defaultTime.split(":").map(Number);

  const emit = (d: string, t: string) => onChange(d ? `${d}T${t || defaultTime}` : "");
  /** Rebuilds "HH:MM" from the three parts, filling any unset part from the default time. */
  const setTime = (patch: { hour?: string; minute?: string; ampm?: string }) => {
    const h12 = Number(patch.hour ?? (hour12 || String(defH % 12 === 0 ? 12 : defH % 12)));
    const m = Number(patch.minute ?? (minute || pad(defM)));
    const pm = (patch.ampm ?? (ampm || (defH < 12 ? "AM" : "PM"))) === "PM";
    const h = (h12 % 12) + (pm ? 12 : 0);
    emit(date || today, `${pad(h)}:${pad(m)}`);
  };
  const part = cn(box, "appearance-none px-2 text-center", invalid && "border-rose-300");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[150px] flex-1">
          <CalendarDays aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            id={id}
            type="date"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={date}
            disabled={disabled}
            onChange={(e) => emit(e.target.value, time)}
            // Clicking anywhere on the field opens the calendar, not just the icon (owner, 14 Nov 2026).
            onClick={(e) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {
                // Some browsers refuse showPicker outside a direct user gesture; the icon still works.
              }
            }}
            className={cn(box, "cursor-pointer pr-2 pl-9 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60", invalid && "border-rose-300")}
          />
        </div>
        <div role="group" aria-label="Time" className="flex shrink-0 items-center gap-1">
          <Clock aria-hidden="true" className="mr-0.5 size-4 text-zinc-400" />
          <select aria-label="Hour" value={hour12} disabled={disabled} onChange={(e) => setTime({ hour: e.target.value })} className={cn(part, "w-[58px]")}>
            {!hour12 ? <option value="">hh</option> : null}
            {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <span aria-hidden="true" className="font-black text-zinc-400">
            :
          </span>
          <select aria-label="Minute" value={minute} disabled={disabled} onChange={(e) => setTime({ minute: e.target.value })} className={cn(part, "w-[58px]")}>
            {!minute ? <option value="">mm</option> : null}
            {Array.from({ length: 60 }, (_, i) => pad(i)).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select aria-label="AM or PM" value={ampm} disabled={disabled} onChange={(e) => setTime({ ampm: e.target.value })} className={cn(part, "w-[62px]")}>
            {!ampm ? <option value="">--</option> : null}
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </div>
      </div>
      {quick || (clearable && value) ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {quick
            ? QUICK.map((q) => {
                const d = addDays(today, q.days);
                const on = date === d;
                return (
                  <button
                    key={q.label}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    onClick={() => emit(d, time)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-colors disabled:opacity-50",
                      on ? "border-brand bg-brand text-white" : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50",
                    )}
                  >
                    {q.label}
                  </button>
                );
              })
            : null}
          {clearable && value ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange("")}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            >
              <X aria-hidden="true" className="size-3" />
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
