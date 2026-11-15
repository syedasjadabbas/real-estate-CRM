import { and, asc, count, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import { addDays, businessToday } from "@/modules/bookings/today";
import { upcomingHolidays } from "@/modules/holidays/service";
import { GRANTED_STATUSES } from "@/modules/leave/rules";
import { leaveOverview } from "@/modules/leave/service";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { attendanceRecords, employeeProfiles, leaveRequests, users } from "@/server/db/schema";
import { forbidden } from "@/server/errors";
import { localTime } from "./rules";
import { canViewAttendance, dailySheet, monthlySummary } from "./service";

/** How far back the "missing check-outs" list looks. */
const MISSING_DAYS = 30;

/**
 * HR's home dashboard (owner, 15 Nov 2026): people and time off instead of the sales analytics.
 * Today's attendance, leave waiting for a decision, days to correct, headcount, who is away this
 * week, upcoming holidays and this month's lateness and absences.
 */
export async function hrDashboard(db: Database, actor: Actor, today = businessToday()) {
  if (!canViewAttendance(actor)) throw forbidden();
  const weekEnd = addDays(today, 6);
  const month = today.slice(0, 7);

  const sheet = await dailySheet(db, actor, today, today);
  const leave = await leaveOverview(db, actor, Number(today.slice(0, 4)));
  const summary = await monthlySummary(db, actor, month, today);
  const holidays = await upcomingHolidays(db, { limit: 5, today });

  const missing = await db
    .select({ userId: attendanceRecords.userId, name: users.name, date: attendanceRecords.date, checkInAt: attendanceRecords.checkInAt })
    .from(attendanceRecords)
    .innerJoin(users, eq(users.id, attendanceRecords.userId))
    .where(and(isNull(attendanceRecords.checkOutAt), lt(attendanceRecords.date, today), gte(attendanceRecords.date, addDays(today, -MISSING_DAYS)), eq(users.status, "active")))
    .orderBy(asc(attendanceRecords.date), asc(users.name))
    .limit(20);

  const away = await db
    .select({ userId: leaveRequests.userId, name: users.name, type: leaveRequests.type, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, days: leaveRequests.days })
    .from(leaveRequests)
    .innerJoin(users, eq(users.id, leaveRequests.userId))
    .where(and(inArray(leaveRequests.status, GRANTED_STATUSES), lte(leaveRequests.startDate, weekEnd), gte(leaveRequests.endDate, today)))
    .orderBy(asc(leaveRequests.startDate), asc(users.name));

  const [accounts] = await db.select({ n: count() }).from(users).where(eq(users.status, "active"));
  const [noLogin] = await db.select({ n: count() }).from(employeeProfiles).where(and(isNull(employeeProfiles.userId), eq(employeeProfiles.status, "active")));
  const [joiners] = await db.select({ n: count() }).from(employeeProfiles).where(and(gte(employeeProfiles.joiningDate, `${month}-01`), lte(employeeProfiles.joiningDate, today)));

  const ranked = (key: "late" | "absent") =>
    summary.rows
      .filter((r) => r[key] > 0)
      .sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name))
      .slice(0, 5)
      .map((r) => ({ userId: r.userId, name: r.name, n: r[key] }));

  return {
    today,
    weekEnd,
    settings: sheet.settings,
    attendance: {
      counts: sheet.counts,
      total: sheet.rows.length,
      notCheckedIn: sheet.rows.filter((r) => r.status === "not_yet").map((r) => ({ userId: r.userId, name: r.name })),
      late: sheet.rows.filter((r) => r.status === "late").map((r) => ({ userId: r.userId, name: r.name, checkIn: r.checkIn })),
    },
    pendingLeave: leave.decidable.slice(0, 8),
    pendingLeaveTotal: leave.decidable.length,
    cancellations: leave.cancellations.length,
    missingCheckOuts: missing.map((m) => ({ ...m, checkIn: localTime(m.checkInAt) })),
    headcount: { accounts: accounts.n, noLogin: noLogin.n, joinersThisMonth: joiners.n },
    away,
    holidays: holidays.rows,
    month: { month, topLate: ranked("late"), topAbsent: ranked("absent") },
  };
}

export type HrDashboardData = Awaited<ReturnType<typeof hrDashboard>>;
