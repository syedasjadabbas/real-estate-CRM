import { addDays } from "@/modules/teams/dates";

export const TARGET_PERIODS = ["daily", "weekly", "monthly"] as const;
export type TargetPeriod = (typeof TARGET_PERIODS)[number];
export const TARGET_PERIOD_LABELS: Record<TargetPeriod, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

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

/** Achievement window in business time (Asia/Karachi, UTC+5, no DST) — assumption T-A9. */
export function periodWindow(period: TargetPeriod, start: string) {
  return { from: new Date(`${start}T00:00:00+05:00`), to: new Date(`${nextPeriodStart(period, start)}T00:00:00+05:00`) };
}

/** Achieved ÷ target as a whole percent; null when there is no target or no data. */
export function percent(achieved: number | null, target: number) {
  if (achieved === null || target <= 0) return null;
  return Math.floor((achieved / target) * 100);
}
