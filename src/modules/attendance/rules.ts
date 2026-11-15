import { BUSINESS_TIME_ZONE } from "@/modules/leads/constants";

/**
 * Attendance rules (owner, 15 Nov 2026): people check in and out in the CRM; HR sets the office
 * hours, the late cut-off and the weekly days off. Everything here is pure so it can be tested.
 */

export const ATTENDANCE_STATUSES = ["present", "late", "absent", "on_leave", "holiday", "weekend", "not_yet", "upcoming", "not_tracked"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  on_leave: "On leave",
  holiday: "Holiday",
  weekend: "Day off",
  not_yet: "Not checked in",
  upcoming: "—",
  not_tracked: "Not tracked",
};

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type AttendanceSettings = {
  /** "HH:MM", business time zone. */
  officeStart: string;
  /** A check-in after this time is late. */
  lateAfter: string;
  officeEnd: string;
  /** Weekly days off, 0 = Sunday … 6 = Saturday. */
  weekendDays: number[];
};

export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = { officeStart: "09:00", lateAfter: "09:15", officeEnd: "18:00", weekendDays: [0] };

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" → minutes after midnight. */
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The local clock time ("HH:MM") of an instant in the business time zone. */
export const localTime = (at: Date) => timeFmt.format(at);
/** The business day (YYYY-MM-DD) of an instant. */
export const localDate = (at: Date) => dateFmt.format(at);

/** The instant for a business day and a local "HH:MM" (Asia/Karachi is UTC+5 all year, no daylight saving). */
export function instantOf(date: string, hhmm: string) {
  return new Date(`${date}T${hhmm}:00+05:00`);
}

/** Day of the week (0 = Sunday) of a YYYY-MM-DD date. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** "November 2026" for "2026-11". */
export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

/** The month `by` months before or after "YYYY-MM". */
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** Every date of a month ("YYYY-MM"), as YYYY-MM-DD. */
export function datesOfMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Minutes between check-in and check-out; null while still checked in. */
export function workedMinutes(checkInAt: Date, checkOutAt: Date | null) {
  if (!checkOutAt) return null;
  return Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60_000));
}

export const formatMinutes = (m: number | null) => (m === null ? "—" : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);

/**
 * One person's status for one day. A check-in always counts (present or late), even on a holiday,
 * a day off or a leave day. Without one: leave, then holiday, then day off; a past working day is
 * absent, today is "not checked in" and a future day has no status yet.
 */
export function dayStatus(input: {
  date: string;
  today: string;
  checkInAt: Date | null;
  onLeave: boolean;
  holiday: boolean;
  settings: AttendanceSettings;
  /**
   * First day this person's attendance counts: the later of the day attendance started in the CRM and
   * the day they joined (15 Nov 2026). Earlier days are "not tracked", never absent.
   */
  trackedFrom?: string;
}): AttendanceStatus {
  const { date, today, checkInAt, onLeave, holiday, settings, trackedFrom } = input;
  if (checkInAt) return minutesOf(localTime(checkInAt)) > minutesOf(settings.lateAfter) ? "late" : "present";
  if (trackedFrom && date < trackedFrom) return "not_tracked";
  if (onLeave) return "on_leave";
  if (holiday) return "holiday";
  if (settings.weekendDays.includes(weekdayOf(date))) return "weekend";
  if (date > today) return "upcoming";
  if (date === today) return "not_yet";
  return "absent";
}
