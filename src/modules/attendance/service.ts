import { and, asc, between, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { businessToday } from "@/modules/bookings/today";
import { GRANTED_STATUSES } from "@/modules/leave/rules";
import { parseTask as parse } from "@/modules/tasks/support";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { appSettings, attendanceRecords, auditLogs, employeeProfiles, holidays, leaveRequests, users } from "@/server/db/schema";
import { AppError, forbidden, notFound } from "@/server/errors";
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  HHMM,
  datesOfMonth,
  dayStatus,
  instantOf,
  localDate,
  localTime,
  minutesOf,
  workedMinutes,
  type AttendanceSettings,
  type AttendanceStatus,
} from "./rules";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbOrTx = Database | Tx;

const KEYS = { officeStart: "attendance.office_start", lateAfter: "attendance.late_after", officeEnd: "attendance.office_end", weekendDays: "attendance.weekend_days" } as const;

// ─── Permissions ─────────────────────────────────────────────────────────────

/** HR, Admins and Super Admins see everyone's attendance, set office hours and correct days. */
export const canViewAttendance = (actor: Pick<Actor, "role">) => actor.role === "hr" || actor.role === "admin" || actor.role === "super_admin";
export const canManageAttendance = canViewAttendance;

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getAttendanceSettings(db: DbOrTx): Promise<AttendanceSettings> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, Object.values(KEYS)));
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const time = (k: string, fallback: string) => {
    const v = get(k);
    return v && HHMM.test(v) ? v : fallback;
  };
  const weekend = get(KEYS.weekendDays);
  return {
    officeStart: time(KEYS.officeStart, DEFAULT_ATTENDANCE_SETTINGS.officeStart),
    lateAfter: time(KEYS.lateAfter, DEFAULT_ATTENDANCE_SETTINGS.lateAfter),
    officeEnd: time(KEYS.officeEnd, DEFAULT_ATTENDANCE_SETTINGS.officeEnd),
    weekendDays:
      weekend === null
        ? DEFAULT_ATTENDANCE_SETTINGS.weekendDays
        : weekend
            .split(",")
            .filter(Boolean)
            .map(Number)
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
  };
}

const hhmm = (label: string) => z.string().regex(HHMM, `Enter the ${label} as HH:MM`);
const settingsSchema = z
  .object({
    officeStart: hhmm("office start"),
    lateAfter: hhmm("late cut-off"),
    officeEnd: hhmm("office end"),
    weekendDays: z.array(z.coerce.number().int().min(0).max(6)).max(6, "Leave at least one working day"),
  })
  .strict()
  .refine((v) => minutesOf(v.lateAfter) >= minutesOf(v.officeStart), { path: ["lateAfter"], message: "The late cut-off must be at or after the office start" })
  .refine((v) => minutesOf(v.officeEnd) > minutesOf(v.officeStart), { path: ["officeEnd"], message: "The office end must be after the office start" });

export async function updateAttendanceSettings(db: Database, actor: Actor, input: unknown) {
  if (!canManageAttendance(actor)) throw forbidden();
  const data = parse(settingsSchema, input);
  const next: Record<keyof typeof KEYS, string> = {
    officeStart: data.officeStart,
    lateAfter: data.lateAfter,
    officeEnd: data.officeEnd,
    weekendDays: [...new Set(data.weekendDays)].sort().join(","),
  };
  return db.transaction(async (tx) => {
    const before = await getAttendanceSettings(tx);
    const prev: Record<keyof typeof KEYS, string> = { ...before, weekendDays: before.weekendDays.join(",") };
    const changed = (Object.keys(KEYS) as (keyof typeof KEYS)[]).filter((k) => prev[k] !== next[k]);
    for (const k of changed) {
      await tx
        .insert(appSettings)
        .values({ key: KEYS[k], value: next[k], updatedById: actor.id })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: next[k], updatedById: actor.id, updatedAt: new Date() } });
      await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "app.setting", entity: "app_setting", entityId: KEYS[k], before: { value: prev[k] }, after: { value: next[k] } });
    }
    return { changed: changed as string[] };
  });
}

// ─── Check in / out ──────────────────────────────────────────────────────────

async function audit(tx: Tx, actor: Actor, action: string, id: string, after: Record<string, unknown>, before: Record<string, unknown> | null = null) {
  await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action, entity: "attendance_record", entityId: id, before, after });
}

/** Check in for today (business time zone). Once per day. */
export async function checkIn(db: Database, actor: Actor, now = new Date()) {
  const date = localDate(now);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(attendanceRecords)
      .values({ userId: actor.id, date, checkInAt: now })
      .onConflictDoNothing({ target: [attendanceRecords.userId, attendanceRecords.date] })
      .returning({ id: attendanceRecords.id });
    if (!row) {
      const [existing] = await tx.select({ checkInAt: attendanceRecords.checkInAt }).from(attendanceRecords).where(and(eq(attendanceRecords.userId, actor.id), eq(attendanceRecords.date, date)));
      throw new AppError("BUSINESS_RULE", `You already checked in today at ${localTime(existing.checkInAt)}.`);
    }
    await audit(tx, actor, "attendance.check_in", row.id, { date, at: now.toISOString() });
    return { id: row.id, date, checkInAt: now };
  });
}

/** Check out for today. Needs today's check-in; once per day. */
export async function checkOut(db: Database, actor: Actor, now = new Date()) {
  const date = localDate(now);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.userId, actor.id), eq(attendanceRecords.date, date)))
      .for("update");
    if (!row) throw new AppError("BUSINESS_RULE", "Check in first.");
    if (row.checkOutAt) throw new AppError("BUSINESS_RULE", `You already checked out today at ${localTime(row.checkOutAt)}.`);
    await tx.update(attendanceRecords).set({ checkOutAt: now, updatedAt: now }).where(eq(attendanceRecords.id, row.id));
    await audit(tx, actor, "attendance.check_out", row.id, { date, at: now.toISOString() });
    return { id: row.id, date, checkOutAt: now, minutes: workedMinutes(row.checkInAt, now) };
  });
}

// ─── Corrections ─────────────────────────────────────────────────────────────

const correctionSchema = z
  .object({
    userId: z.uuid("Choose a person"),
    date: z.iso.date("Choose the date"),
    checkIn: hhmm("check-in time"),
    checkOut: z.union([hhmm("check-out time"), z.literal(""), z.null()]).optional().transform((v) => v || null),
    note: z.string().trim().min(1, "Give a reason for the correction").max(300, "Use at most 300 characters"),
  })
  .strict()
  .refine((v) => !v.checkOut || minutesOf(v.checkOut) >= minutesOf(v.checkIn), { path: ["checkOut"], message: "Check-out must be after check-in" });

/**
 * HR, Admins and Super Admins correct a day (a forgotten check-in or check-out), with a reason.
 * Nobody corrects their own attendance; a future day can't be recorded.
 */
export async function correctAttendance(db: Database, actor: Actor, input: unknown) {
  if (!canManageAttendance(actor)) throw forbidden();
  const data = parse(correctionSchema, input);
  if (data.userId === actor.id) throw forbidden("You can't correct your own attendance.");
  if (data.date > businessToday()) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { date: "That day hasn't happened yet" } });
  const checkInAt = instantOf(data.date, data.checkIn);
  const checkOutAt = data.checkOut ? instantOf(data.date, data.checkOut) : null;
  return db.transaction(async (tx) => {
    const [person] = await tx.select({ id: users.id }).from(users).where(eq(users.id, data.userId));
    if (!person) throw notFound("Person");
    const [before] = await tx.select().from(attendanceRecords).where(and(eq(attendanceRecords.userId, data.userId), eq(attendanceRecords.date, data.date))).for("update");
    const values = { checkInAt, checkOutAt, correctedById: actor.id, correctionNote: data.note, updatedAt: new Date() };
    const [row] = before
      ? await tx.update(attendanceRecords).set(values).where(eq(attendanceRecords.id, before.id)).returning({ id: attendanceRecords.id })
      : await tx.insert(attendanceRecords).values({ userId: data.userId, date: data.date, ...values }).returning({ id: attendanceRecords.id });
    await audit(
      tx,
      actor,
      "attendance.correct",
      row.id,
      { userId: data.userId, date: data.date, checkIn: data.checkIn, checkOut: data.checkOut, note: data.note },
      before ? { checkIn: localTime(before.checkInAt), checkOut: before.checkOutAt ? localTime(before.checkOutAt) : null } : null,
    );
    return { id: row.id };
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

type Rec = typeof attendanceRecords.$inferSelect;

/**
 * The day attendance started in the CRM: the earliest check-in anyone has made, or today when nobody
 * has checked in yet. Days before it are never counted as absences (15 Nov 2026).
 */
async function trackingStart(db: DbOrTx, today: string) {
  const [row] = await db.select({ first: sql<string | null>`min(${attendanceRecords.date})::text` }).from(attendanceRecords);
  return row?.first && row.first < today ? row.first : today;
}

/** Each person's first counted day: the later of the tracking start and the day they joined (or their account was made). */
async function trackedFromByUser(db: DbOrTx, userIds: string[], today: string) {
  const start = await trackingStart(db, today);
  const rows = await db
    .select({ id: users.id, createdOn: sql<string>`(${users.createdAt} at time zone 'Asia/Karachi')::date::text`, joined: sql<string | null>`${employeeProfiles.joiningDate}::text` })
    .from(users)
    .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
    .where(inArray(users.id, userIds));
  return new Map(rows.map((r) => {
    const personStart = r.joined ?? r.createdOn;
    return [r.id, personStart > start ? personStart : start];
  }));
}

/** Records, granted leave and company holidays for some people over a date range. */
async function loadRange(db: DbOrTx, userIds: string[], from: string, to: string, today = businessToday()) {
  if (userIds.length === 0) return { records: [] as Rec[], leave: [] as { userId: string; startDate: string; endDate: string }[], holidayDates: new Set<string>(), trackedFrom: new Map<string, string>() };
  const records = await db.select().from(attendanceRecords).where(and(inArray(attendanceRecords.userId, userIds), between(attendanceRecords.date, from, to)));
  const leave = await db
    .select({ userId: leaveRequests.userId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
    .from(leaveRequests)
    .where(and(inArray(leaveRequests.userId, userIds), inArray(leaveRequests.status, GRANTED_STATUSES), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from)));
  const hols = await db.select({ date: holidays.date }).from(holidays).where(and(eq(holidays.scope, "company"), between(holidays.date, from, to)));
  const trackedFrom = await trackedFromByUser(db, userIds, today);
  return { records, leave, holidayDates: new Set(hols.map((h) => h.date)), trackedFrom };
}

function statusFor(
  userId: string,
  date: string,
  today: string,
  settings: AttendanceSettings,
  data: Awaited<ReturnType<typeof loadRange>>,
  byKey: Map<string, Rec>,
): { status: AttendanceStatus; record: Rec | null } {
  const record = byKey.get(`${userId}|${date}`) ?? null;
  const onLeave = data.leave.some((l) => l.userId === userId && l.startDate <= date && date <= l.endDate);
  return { status: dayStatus({ date, today, checkInAt: record?.checkInAt ?? null, onLeave, holiday: data.holidayDates.has(date), settings, trackedFrom: data.trackedFrom.get(userId) }), record };
}

const activePeople = (db: DbOrTx) =>
  db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.status, "active")).orderBy(asc(users.name));

export type SheetRow = {
  userId: string;
  name: string;
  role: string;
  status: AttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  minutes: number | null;
  corrected: boolean;
  correctionNote: string | null;
  /** Who corrected the day (HR, an Admin or a Super Admin). */
  correctedBy: string | null;
};

/** The daily sheet: every active person's status, times and hours for one day. */
export async function dailySheet(db: Database, actor: Actor, date: string, today = businessToday()) {
  if (!canViewAttendance(actor)) throw forbidden();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const settings = await getAttendanceSettings(db);
  const people = await activePeople(db);
  const data = await loadRange(db, people.map((p) => p.id), day, day, today);
  const byKey = new Map(data.records.map((r) => [`${r.userId}|${r.date}`, r]));
  const correctorIds = [...new Set(data.records.map((r) => r.correctedById).filter((x): x is string => Boolean(x)))];
  const correctors = new Map(correctorIds.length ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, correctorIds))).map((u) => [u.id, u.name]) : []);
  const rows: SheetRow[] = people.map((p) => {
    const { status, record } = statusFor(p.id, day, today, settings, data, byKey);
    return {
      userId: p.id,
      name: p.name,
      role: p.role,
      status,
      checkIn: record ? localTime(record.checkInAt) : null,
      checkOut: record?.checkOutAt ? localTime(record.checkOutAt) : null,
      minutes: record ? workedMinutes(record.checkInAt, record.checkOutAt) : null,
      corrected: Boolean(record?.correctedById),
      correctionNote: record?.correctionNote ?? null,
      correctedBy: record?.correctedById ? (correctors.get(record.correctedById) ?? null) : null,
    };
  });
  const counts = Object.fromEntries(["present", "late", "absent", "on_leave", "holiday", "weekend", "not_yet"].map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<string, number>;
  return { date: day, today, settings, rows, counts };
}

export type MonthRow = { userId: string; name: string; role: string; present: number; late: number; absent: number; onLeave: number; holiday: number; workingDays: number; minutes: number; missingCheckOut: number };

function summarise(userId: string, dates: string[], today: string, settings: AttendanceSettings, data: Awaited<ReturnType<typeof loadRange>>, byKey: Map<string, Rec>) {
  const s = { present: 0, late: 0, absent: 0, onLeave: 0, holiday: 0, workingDays: 0, minutes: 0, missingCheckOut: 0 };
  for (const date of dates) {
    if (date > today) break;
    const { status, record } = statusFor(userId, date, today, settings, data, byKey);
    if (status === "present") s.present++;
    else if (status === "late") s.late++;
    else if (status === "absent") s.absent++;
    else if (status === "on_leave") s.onLeave++;
    else if (status === "holiday") s.holiday++;
    if (status !== "weekend" && status !== "holiday" && status !== "upcoming" && status !== "not_tracked") s.workingDays++;
    if (record) {
      const m = workedMinutes(record.checkInAt, record.checkOutAt);
      if (m === null) {
        if (date < today) s.missingCheckOut++;
      } else s.minutes += m;
    }
  }
  return s;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Monthly summary per active person, counted up to today. */
export async function monthlySummary(db: Database, actor: Actor, month: string, today = businessToday()) {
  if (!canViewAttendance(actor)) throw forbidden();
  const m = MONTH.test(month) ? month : today.slice(0, 7);
  const settings = await getAttendanceSettings(db);
  const people = await activePeople(db);
  const dates = datesOfMonth(m);
  const data = await loadRange(db, people.map((p) => p.id), dates[0], dates[dates.length - 1], today);
  const byKey = new Map(data.records.map((r) => [`${r.userId}|${r.date}`, r]));
  const rows: MonthRow[] = people.map((p) => ({ userId: p.id, name: p.name, role: p.role, ...summarise(p.id, dates, today, settings, data, byKey) }));
  return { month: m, today, rows };
}

/** My workplace: today's record and this month's tally for the signed-in person. */
export async function myAttendance(db: Database, actor: Actor, now = new Date()) {
  const today = localDate(now);
  const settings = await getAttendanceSettings(db);
  const dates = datesOfMonth(today.slice(0, 7));
  const data = await loadRange(db, [actor.id], dates[0], dates[dates.length - 1], today);
  const byKey = new Map(data.records.map((r) => [`${r.userId}|${r.date}`, r]));
  const { status, record } = statusFor(actor.id, today, today, settings, data, byKey);
  return {
    today,
    settings,
    status,
    checkIn: record ? localTime(record.checkInAt) : null,
    checkOut: record?.checkOutAt ? localTime(record.checkOutAt) : null,
    minutes: record ? workedMinutes(record.checkInAt, record.checkOutAt) : null,
    month: summarise(actor.id, dates, today, settings, data, byKey),
  };
}
