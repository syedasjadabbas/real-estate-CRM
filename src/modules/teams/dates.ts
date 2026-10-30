import { BUSINESS_TIME_ZONE } from "@/modules/leads/constants";
import { businessToday } from "@/modules/bookings/today";

/** The observed roster lock: a day's duty can be changed until 11:00 (business time) that day. */
export const ROSTER_LOCK_HOUR = 11;

export function businessHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(now));
}

/** FR-121: a team's daily report is editable on its own date only (assumption T-A4). */
export function dailyReportEditable(date: string, now = new Date()) {
  return date === businessToday(now);
}

/** Observed: future days are editable; today until 11:00; earlier days are view-only (T-A6). */
export function rosterEditable(date: string, now = new Date()) {
  const today = businessToday(now);
  return date > today || (date === today && businessHour(now) < ROSTER_LOCK_HOUR);
}

/** YYYY-MM-DD arithmetic on calendar dates (UTC-based, no time zone drift). */
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function monthDays(month: string) {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}
