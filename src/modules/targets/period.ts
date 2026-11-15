import { addDays } from "@/modules/teams/dates";

/** "custom": any From–To range, e.g. a 15-day campaign (owner, 15 Nov 2026). */
export const TARGET_PERIODS = ["daily", "weekly", "monthly", "custom"] as const;
export type TargetPeriod = (typeof TARGET_PERIODS)[number];
export const TARGET_PERIOD_LABELS: Record<TargetPeriod, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", custom: "Custom dates" };
/** The longest custom period: one year. */
export const MAX_CUSTOM_DAYS = 366;

/** Observed: monthly starts on the 1st, weekly on Monday, daily on the anchor date. */
export function periodStart(period: TargetPeriod, anchor: string) {
  if (period === "monthly") return `${anchor.slice(0, 7)}-01`;
  if (period === "weekly") {
    const dow = new Date(`${anchor}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    return addDays(anchor, -((dow + 6) % 7));
  }
  return anchor;
}

export function nextPeriodStart(period: TargetPeriod, start: string) {
  if (period === "daily") return addDays(start, 1);
  if (period === "weekly") return addDays(start, 7);
  const [y, m] = start.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/** Achievement window in business time (Asia/Karachi, UTC+5, no DST) — assumption T-A9. A custom period runs to the end of its last day. */
export function periodWindow(period: TargetPeriod, start: string, end?: string | null) {
  const next = period === "custom" ? addDays(end ?? start, 1) : nextPeriodStart(period, start);
  return { from: new Date(`${start}T00:00:00+05:00`), to: new Date(`${next}T00:00:00+05:00`) };
}

/** "1 Nov – 15 Nov 2026" style label of a target period. */
export function periodLabel(period: TargetPeriod, start: string, end?: string | null) {
  if (period !== "custom" || !end) return start;
  return start === end ? start : `${start} → ${end}`;
}

/** Achieved ÷ target as a whole percent; null when there is no target or no data. */
export function percent(achieved: number | null, target: number) {
  if (achieved === null || target <= 0) return null;
  return Math.floor((achieved / target) * 100);
}
