import type { Role } from "@/server/auth/types";

/**
 * Leave rules from the client questionnaire (2 Nov 2026). Pure functions, dates as "YYYY-MM-DD".
 * - Q8: calendar days, inclusive (weekends and holidays count).
 * - Q4: the same allowance for everyone (setting, default 30 days; value to confirm, C-7).
 * - Q13: prorated for joiners. The METHOD is not defined yet (C-10); see `proratedAllowance`.
 * - Q14: no carry-forward; each calendar year starts again (leave year to confirm, C-11).
 * - Q17: a request spanning two calendar years is accepted but HELD: it counts against neither
 *   year and can't be approved until the client confirms how its days are deducted (C-13).
 */
export const DEFAULT_ANNUAL_DAYS = 30;
export const LEAVE_TYPES = ["annual", "medical"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = { annual: "Annual", medical: "Medical (CPL)" };

export type LeaveStatus = "pending" | "approved" | "rejected" | "withdrawn" | "cancel_requested" | "cancelled";
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  cancel_requested: "Cancellation requested",
  cancelled: "Cancelled",
};
/** Statuses that hold days against the balance (pending holds them so requests can't stack past it). */
export const HOLDING_STATUSES: LeaveStatus[] = ["pending", "approved", "cancel_requested"];
/** Statuses that count as leave actually granted. */
export const GRANTED_STATUSES: LeaveStatus[] = ["approved", "cancel_requested"];

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function calendarDays(start: string, end: string) {
  return Math.round((utc(end) - utc(start)) / DAY) + 1;
}

export const yearOf = (d: string) => Number(d.slice(0, 4));

const daysInYear = (year: number) => calendarDays(`${year}-01-01`, `${year}-12-31`);

/**
 * Joiner proration (Q13: "Yes"). The client has not said HOW (clarification C-10), so methods are
 * registered here and chosen by the `leave.proration_method` setting. Adding the confirmed method
 * means adding one entry; nothing else changes.
 *
 * `provisional_calendar_days` (the only method so far, NOT client-approved):
 *   allowance = round_to_half_day( annualDays × daysFromJoiningDateTo31Dec(inclusive) ÷ daysInYear )
 *   e.g. 30 days, joining 2 July 2026: 30 × 183 ÷ 365 = 15.04 → 15.
 * Joined in an earlier year (or no joining date): the full allowance. Joining in a later year: 0.
 */
export const PRORATION_METHODS = {
  provisional_calendar_days: {
    label: "Provisional: share of calendar days left in the year, to the nearest half day (awaiting company confirmation)",
    provisional: true,
    allowance(annualDays: number, joiningDate: string, year: number) {
      const share = calendarDays(joiningDate, `${year}-12-31`) / daysInYear(year);
      return Math.round(annualDays * share * 2) / 2;
    },
  },
} as const;
export type ProrationMethod = keyof typeof PRORATION_METHODS;
export const DEFAULT_PRORATION_METHOD: ProrationMethod = "provisional_calendar_days";

export function proratedAllowance(annualDays: number, joiningDate: string | null, year: number, method: ProrationMethod = DEFAULT_PRORATION_METHOD) {
  if (!joiningDate || yearOf(joiningDate) < year) return { days: annualDays, prorated: false, provisional: false };
  if (yearOf(joiningDate) > year) return { days: 0, prorated: true, provisional: false };
  const m = PRORATION_METHODS[method];
  return { days: m.allowance(annualDays, joiningDate, year), prorated: true, provisional: m.provisional };
}

/** Q7: leave of managers, HR, admins and super admins is approved by a Super Admin; others follow the two staff steps (Q6). */
export function approvalPathFor(role: Role): "senior" | "staff" {
  return role === "agent" || role === "accountant" ? "staff" : "senior";
}

/** Who may approve a staff step. The client has not said who approves first and second (C-4): an admin sets them. */
export const STAFF_STEP_APPROVERS = ["team_manager", "hr", "admin"] as const;
export type StaffStepApprover = (typeof STAFF_STEP_APPROVERS)[number];
export const STAFF_STEP_LABELS: Record<StaffStepApprover, string> = { team_manager: "Team manager", hr: "HR", admin: "Admin or Super Admin" };

export function overlaps(a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/** Every date of a request, inclusive. */
export function datesOf(start: string, end: string) {
  const out: string[] = [];
  for (let t = utc(start); t <= utc(end); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Q17 / C-13: requests across two calendar years are held until the deduction rule is confirmed. */
export const isCrossYear = (r: { startDate: string; endDate: string }) => yearOf(r.startDate) !== yearOf(r.endDate);
export const CROSS_YEAR_HELD_NOTE = "Held: spans two calendar years. It isn't counted or approvable until the company confirms how such leave is deducted.";
