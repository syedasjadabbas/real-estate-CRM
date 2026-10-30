import { z } from "zod";
import { businessToday } from "@/modules/bookings/today";
import { addDays } from "@/modules/teams/dates";

/** Observed default: the last 30 days (e.g. 2026-09-29 → 2026-10-29). */
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

export const PERFORMANCE_SORTS = ["agent", "open", "booked", "lost", "winPct", "fuDue", "fuDone", "fuPct", "meetings", "signIns", "signOuts"] as const;
export type PerformanceSort = (typeof PERFORMANCE_SORTS)[number];

export const PERFORMANCE_PAGE_SIZE = 25;

export const performanceQuerySchema = z.object({
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  team: z.uuid().optional().catch(undefined),
  sort: z.enum(PERFORMANCE_SORTS).catch("agent"),
  dir: z.enum(["asc", "desc"]).catch("asc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/**
 * FROM / TO inclusive in Pakistan time (P1). Invalid or reversed input falls back to the default
 * window; spans longer than a year are clamped so one request can't scan the whole history.
 */
export function resolveRange(from: string | undefined, to: string | undefined, now = new Date()) {
  const today = businessToday(now);
  let end = to ?? today;
  let start = from ?? addDays(end, -DEFAULT_RANGE_DAYS);
  if (start > end) [start, end] = [end, start];
  if (addDays(start, MAX_RANGE_DAYS) < end) start = addDays(end, -MAX_RANGE_DAYS);
  return {
    from: start,
    to: end,
    window: { start: new Date(`${start}T00:00:00+05:00`), end: new Date(`${addDays(end, 1)}T00:00:00+05:00`) },
  };
}

export function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}
