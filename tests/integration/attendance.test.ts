import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dayStatus, DEFAULT_ATTENDANCE_SETTINGS, instantOf, localTime } from "@/modules/attendance/rules";
import { hrDashboard } from "@/modules/attendance/hr-dashboard";
import { checkIn, checkOut, correctAttendance, dailySheet, monthlySummary, myAttendance, updateAttendanceSettings } from "@/modules/attendance/service";
import { holidays, leaveRequests, auditLogs, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
};

describe("attendance rules", () => {
  const s = DEFAULT_ATTENDANCE_SETTINGS;
  const base = { today: "2026-11-18", onLeave: false, holiday: false, settings: s };
  it("works out each day's status", () => {
    expect(dayStatus({ ...base, date: "2026-11-17", checkInAt: instantOf("2026-11-17", "09:15") })).toBe("present");
    expect(dayStatus({ ...base, date: "2026-11-17", checkInAt: instantOf("2026-11-17", "09:16") })).toBe("late");
    expect(dayStatus({ ...base, date: "2026-11-17", checkInAt: null })).toBe("absent");
    expect(dayStatus({ ...base, date: "2026-11-17", checkInAt: null, onLeave: true })).toBe("on_leave");
    expect(dayStatus({ ...base, date: "2026-11-17", checkInAt: null, holiday: true })).toBe("holiday");
    expect(dayStatus({ ...base, date: "2026-11-15", checkInAt: null })).toBe("weekend"); // Sunday
    expect(dayStatus({ ...base, date: "2026-11-18", checkInAt: null })).toBe("not_yet");
    expect(dayStatus({ ...base, date: "2026-11-19", checkInAt: null })).toBe("upcoming");
    expect(localTime(instantOf("2026-11-17", "08:05"))).toBe("08:05");
  });
});

describe.skipIf(!hasTestDb)("Attendance (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    // Accounts made well before the test month, so only the tracking start limits what counts.
    await db.update(users).set({ createdAt: new Date("2026-10-01T00:00:00+05:00") });
  });

  it("checks in and out once a day and shows the day in My workplace", async () => {
    const a = f.actors.agent1;
    const morning = instantOf("2026-11-17", "09:40");
    await checkIn(db, a, morning);
    expect((await errorOf(checkIn(db, a, instantOf("2026-11-17", "10:00"))))?.message).toMatch(/already checked in today at 09:40/);
    expect((await errorOf(checkOut(db, f.actors.agent2, instantOf("2026-11-17", "18:00"))))?.message).toMatch(/Check in first/);
    expect(await checkOut(db, a, instantOf("2026-11-17", "18:10"))).toMatchObject({ minutes: 510 });
    expect((await errorOf(checkOut(db, a, instantOf("2026-11-17", "18:20"))))?.message).toMatch(/already checked out/);
    const mine = await myAttendance(db, a, instantOf("2026-11-17", "19:00"));
    expect(mine).toMatchObject({ status: "late", checkIn: "09:40", checkOut: "18:10", minutes: 510 });
  });

  it("builds the daily sheet and monthly summary with leave and holidays; only HR and admins see it", async () => {
    const a = f.actors.agent1;
    const b = f.actors.agent2;
    // Attendance started in the CRM on Monday 2 Nov (the first check-in anyone made).
    await checkIn(db, f.actors.outsideAgent, instantOf("2026-11-02", "09:00"));
    await checkIn(db, a, instantOf("2026-11-16", "09:00"));
    await checkOut(db, a, instantOf("2026-11-16", "17:00"));
    await db.insert(leaveRequests).values({ userId: b.id, type: "annual", startDate: "2026-11-16", endDate: "2026-11-16", days: 1, status: "approved", approvalPath: "staff" });
    await db.insert(holidays).values({ date: "2026-11-17", name: "Test holiday" });

    expect((await errorOf(dailySheet(db, a, "2026-11-16", "2026-11-18")))?.code).toBe("FORBIDDEN");
    const sheet = await dailySheet(db, f.actors.hr, "2026-11-16", "2026-11-18");
    const row = (id: string) => sheet.rows.find((r) => r.userId === id)!;
    expect(row(a.id)).toMatchObject({ status: "present", checkIn: "09:00", checkOut: "17:00", minutes: 480 });
    expect(row(b.id).status).toBe("on_leave");
    expect(row(f.actors.manager.id).status).toBe("absent");

    const month = await monthlySummary(db, f.actors.hr, "2026-11", "2026-11-18");
    const ma = month.rows.find((r) => r.userId === a.id)!;
    // 1–18 Nov: Sundays 1, 8, 15 off and the 17th a holiday → 14 working days.
    expect(ma).toMatchObject({ present: 1, holiday: 1, workingDays: 14, minutes: 480 });
    expect(ma.absent).toBe(12); // 18th is today: not yet absent
    expect(month.rows.find((r) => r.userId === b.id)).toMatchObject({ onLeave: 1 });
  });

  it("never counts days before attendance started, or before the person joined, as absences", async () => {
    const a = f.actors.agent1;
    // Nobody checked in before the 16th: earlier days are "not tracked", not absent.
    await checkIn(db, a, instantOf("2026-11-16", "09:00"));
    const month = await monthlySummary(db, f.actors.hr, "2026-11", "2026-11-18");
    const other = month.rows.find((r) => r.userId === f.actors.agent2.id)!;
    expect(other).toMatchObject({ absent: 2, workingDays: 3 }); // 16th and 17th absent, 18th is today
    expect((await dailySheet(db, f.actors.hr, "2026-11-10", "2026-11-18")).rows.find((r) => r.userId === f.actors.agent2.id)?.status).toBe("not_tracked");
    // Someone whose account was made on the 17th isn't absent on the 16th.
    await db.update(users).set({ createdAt: new Date("2026-11-17T10:00:00+05:00") }).where(eq(users.id, f.actors.agent2.id));
    expect((await monthlySummary(db, f.actors.hr, "2026-11", "2026-11-18")).rows.find((r) => r.userId === f.actors.agent2.id)).toMatchObject({ absent: 1, workingDays: 2 });
  });

  it("lets HR correct someone else's day with a reason, and HR or admins change office hours", async () => {
    const a = f.actors.agent1;
    expect((await errorOf(correctAttendance(db, a, { userId: f.actors.agent2.id, date: "2026-11-02", checkIn: "09:00", note: "x" })))?.code).toBe("FORBIDDEN");
    expect((await errorOf(correctAttendance(db, f.actors.hr, { userId: f.actors.hr.id, date: "2026-11-02", checkIn: "09:00", note: "x" })))?.code).toBe("FORBIDDEN");
    expect((await errorOf(correctAttendance(db, f.actors.hr, { userId: a.id, date: "2026-11-02", checkIn: "09:00", checkOut: "08:00", note: "x" })))?.fields?.checkOut).toMatch(/after check-in/);
    const { id } = await correctAttendance(db, f.actors.hr, { userId: a.id, date: "2026-11-02", checkIn: "09:05", checkOut: "18:00", note: "Forgot to check in" });
    const sheet = await dailySheet(db, f.actors.hr, "2026-11-02", "2026-11-18");
    expect(sheet.rows.find((r) => r.userId === a.id)).toMatchObject({ checkIn: "09:05", checkOut: "18:00", corrected: true, correctionNote: "Forgot to check in" });
    expect(await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, id))).toEqual([{ a: "attendance.correct" }]);

    expect((await errorOf(updateAttendanceSettings(db, a, { officeStart: "10:00", lateAfter: "10:15", officeEnd: "19:00", weekendDays: [0] })))?.code).toBe("FORBIDDEN");
    expect((await errorOf(updateAttendanceSettings(db, f.actors.hr, { officeStart: "10:00", lateAfter: "09:00", officeEnd: "19:00", weekendDays: [0] })))?.fields?.lateAfter).toMatch(/at or after/);
    expect(await updateAttendanceSettings(db, f.actors.hr, { officeStart: "10:00", lateAfter: "10:15", officeEnd: "19:00", weekendDays: [0, 6] })).toEqual({ changed: ["officeStart", "lateAfter", "officeEnd", "weekendDays"] });
    const after = await dailySheet(db, f.actors.hr, "2026-11-14", "2026-11-18"); // a Saturday, now a day off
    expect(after.rows.find((r) => r.userId === a.id)?.status).toBe("weekend");
  });

  it("gives HR a people dashboard: today's attendance, leave to decide, missing check-outs, who is away", async () => {
    const a = f.actors.agent1;
    const b = f.actors.agent2;
    // Monday 16 Nov 2026 as "today"; the agent forgot to check out on Friday the 13th.
    await checkIn(db, a, instantOf("2026-11-13", "09:00"));
    await checkIn(db, a, instantOf("2026-11-16", "09:30"));
    await db.insert(leaveRequests).values({ userId: b.id, type: "annual", startDate: "2026-11-18", endDate: "2026-11-19", days: 2, status: "approved", approvalPath: "staff" });
    await db.insert(leaveRequests).values({ userId: f.actors.manager.id, type: "annual", startDate: "2026-11-25", endDate: "2026-11-25", days: 1, approvalPath: "senior" });

    expect((await errorOf(hrDashboard(db, a, "2026-11-16")))?.code).toBe("FORBIDDEN");
    const d = await hrDashboard(db, f.actors.hr, "2026-11-16");
    expect(d.attendance.late).toEqual([{ userId: a.id, name: expect.any(String), checkIn: "09:30" }]);
    expect(d.attendance.notCheckedIn.map((p) => p.userId)).toContain(b.id);
    expect(d.missingCheckOuts).toEqual([expect.objectContaining({ userId: a.id, date: "2026-11-13", checkIn: "09:00" })]);
    expect(d.away.map((l) => l.userId)).toEqual([b.id]);
    // Senior leave is decided by a Super Admin, so HR has nothing to decide here.
    expect(d.pendingLeaveTotal).toBe(0);
    expect((await hrDashboard(db, f.actors.superAdmin, "2026-11-16")).pendingLeaveTotal).toBe(1);
  });
});
