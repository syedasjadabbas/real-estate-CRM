import { BUSINESS_TIME_ZONE } from "@/modules/leads/constants";
import { HOLD_DAYS } from "./constants";

/** Today's date (YYYY-MM-DD) in the business time zone; hold dates are compared against it. */
export function businessToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** `isoDate` (YYYY-MM-DD) plus `days` calendar days, as YYYY-MM-DD. */
export function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** FR-081 default hold: Reserved until = today (business time zone) + HOLD_DAYS. */
export function defaultHoldUntil(now = new Date()) {
  return addDays(businessToday(now), HOLD_DAYS);
}
