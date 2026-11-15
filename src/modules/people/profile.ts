import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, notInArray, sql } from "drizzle-orm";
import { myAttendance } from "@/modules/attendance/service";
import { businessToday } from "@/modules/bookings/today";
import { agentScores } from "@/modules/leads/assignment";
import { LEAD_STAGES, type LeadStage } from "@/modules/leads/constants";
import { leaveBalance } from "@/modules/leave/service";
import { agentMetrics } from "@/modules/performance/service";
import { resolveRange } from "@/modules/performance/range";
import { currentTargets, TARGET_METRICS } from "@/modules/targets/service";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { bookings, employeeProfiles, files, followUps, leadActivities, leads, teamMembers, teams, users } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/errors";
import { z } from "zod";

/**
 * An employee's full profile for Admins and Super Admins (owner, 15 Nov 2026): one page with
 * everything about an agent's work. Range figures (calls, follow-ups, meetings, bookings, leads
 * assigned) use the chosen dates, exactly as Performance does; the pipeline, follow-ups due now,
 * attendance and leave are current.
 */
export const canViewProfiles = (actor: Pick<Actor, "role">) => actor.role === "admin" || actor.role === "super_admin";

const querySchema = z.object({ from: z.iso.date().optional().catch(undefined), to: z.iso.date().optional().catch(undefined) });

export async function employeeProfile(db: Database, actor: Actor, userId: string, rawQuery: unknown = {}, now = new Date()) {
  if (!canViewProfiles(actor)) throw forbidden();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw notFound("Person");
  const [person] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!person) throw notFound("Person");

  const q = querySchema.parse(rawQuery ?? {});
  const range = resolveRange(q.from, q.to, now);
  const today = businessToday(now);
  const todayStart = new Date(`${today}T00:00:00+05:00`);
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);

  const [profile] = await db
    .select({ designation: employeeProfiles.designation, department: employeeProfiles.department, phone: employeeProfiles.phoneE164, joiningDate: employeeProfiles.joiningDate })
    .from(employeeProfiles)
    .where(eq(employeeProfiles.userId, userId))
    .limit(1);
  const manager = users;
  const teamRows = await db
    .select({ id: teams.id, name: teams.name, isActive: teams.isActive, teamLeadId: teams.teamLeadId, managerId: teams.managerId })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teams.name));
  const managerIds = [...new Set(teamRows.map((t) => t.managerId).filter((x): x is string => Boolean(x)))];
  const managerNames = managerIds.length ? await db.select({ id: manager.id, name: manager.name }).from(manager).where(inArray(manager.id, managerIds)) : [];

  const [metrics] = await agentMetrics(db, [{ id: person.id, name: person.name }], range.window);
  const score = (await agentScores(db, [person.id], now)).get(person.id) ?? null;

  const stageRows = await db
    .select({ stage: leads.stage, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.ownerId, userId), isNull(leads.deletedAt)))
    .groupBy(leads.stage);
  const pipeline = LEAD_STAGES.map((s) => ({ stage: s as LeadStage, count: stageRows.find((r) => r.stage === s)?.n ?? 0 }));
  const [untouched] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.ownerId, userId), isNull(leads.deletedAt), isNull(leads.firstTouchAt), notInArray(leads.stage, ["booked", "lost_lead"])));

  const [fu] = await db
    .select({
      overdue: sql<number>`count(*) filter (where ${followUps.dueAt} < ${now})::int`,
      today: sql<number>`count(*) filter (where ${followUps.dueAt} >= ${now} and ${followUps.dueAt} < ${todayEnd})::int`,
      upcoming: sql<number>`count(*) filter (where ${followUps.dueAt} >= ${todayEnd})::int`,
    })
    .from(followUps)
    .where(and(eq(followUps.assigneeId, userId), eq(followUps.status, "pending")));
  const [fuDone] = await db
    .select({
      onTime: sql<number>`count(*) filter (where ${followUps.doneAt} <= ${followUps.dueAt} + interval '1 hour')::int`,
      late: sql<number>`count(*) filter (where ${followUps.doneAt} > ${followUps.dueAt} + interval '1 hour')::int`,
    })
    .from(followUps)
    .where(and(eq(followUps.assigneeId, userId), eq(followUps.status, "done"), gte(followUps.doneAt, range.window.start), lt(followUps.doneAt, range.window.end)));

  const [bk] = await db
    .select({
      made: sql<number>`count(*) filter (where ${bookings.createdAt} >= ${range.window.start} and ${bookings.createdAt} < ${range.window.end})::int`,
      value: sql<string>`coalesce(sum(${bookings.totalSale}) filter (where ${bookings.createdAt} >= ${range.window.start} and ${bookings.createdAt} < ${range.window.end}), 0)`,
      won: sql<number>`count(*) filter (where ${bookings.stage} = 'confirmed' and ${bookings.stageChangedAt} >= ${range.window.start} and ${bookings.stageChangedAt} < ${range.window.end})::int`,
      open: sql<number>`count(*) filter (where ${bookings.stage} not in ('confirmed', 'cancelled'))::int`,
    })
    .from(bookings)
    .where(and(eq(bookings.agentId, userId), ne(bookings.stage, "cancelled")));

  const recordings = await db
    .select({ id: files.id, name: files.originalName, durationSec: files.durationSec, createdAt: files.createdAt, leadId: leads.id, leadName: leads.name, leadCode: leads.code })
    .from(files)
    .innerJoin(leads, eq(leads.id, files.leadId))
    .where(and(eq(files.uploadedById, userId), eq(files.kind, "call_recording"), isNull(files.deletedAt), gte(files.createdAt, range.window.start), lt(files.createdAt, range.window.end)))
    .orderBy(desc(files.createdAt))
    .limit(10);

  const activity = await db
    .select({ id: leadActivities.id, type: leadActivities.type, data: leadActivities.data, createdAt: leadActivities.createdAt, leadId: leads.id, leadName: leads.name, leadCode: leads.code })
    .from(leadActivities)
    .innerJoin(leads, eq(leads.id, leadActivities.leadId))
    .where(and(eq(leadActivities.actorId, userId), isNull(leads.deletedAt)))
    .orderBy(desc(leadActivities.createdAt))
    .limit(15);

  const targetRows = await currentTargets(db, userId, now);
  const targetLines = (p: "daily" | "weekly" | "monthly") => {
    const t = targetRows.find((x) => x.period === p);
    return TARGET_METRICS.map((m) => ({ label: m.label, actual: t?.achieved[m.key] ?? 0, target: t?.goals?.[m.key] || null, met: Boolean(t?.met.includes(m.key)) }));
  };

  const attendance = await myAttendance(db, { ...actor, id: userId } as Actor, now);
  const leave = await leaveBalance(db, userId, Number(today.slice(0, 4)));

  return {
    person,
    profile: profile ?? null,
    teams: teamRows.map((t) => ({ id: t.id, name: t.name, isActive: t.isActive, isLead: t.teamLeadId === userId, admin: managerNames.find((m) => m.id === t.managerId)?.name ?? null })),
    range: { from: range.from, to: range.to },
    today,
    metrics,
    score,
    pipeline,
    untouched: untouched.n,
    followUps: { overdue: fu.overdue, today: fu.today, upcoming: fu.upcoming, doneOnTime: fuDone.onTime, doneLate: fuDone.late },
    bookings: { made: bk.made, value: Number(bk.value), won: bk.won, open: bk.open },
    recordings,
    activity,
    targets: { today: targetLines("daily"), week: targetLines("weekly"), month: targetLines("monthly") },
    attendance: { status: attendance.status, checkIn: attendance.checkIn, checkOut: attendance.checkOut, month: attendance.month },
    leave,
  };
}

export type EmployeeProfile = Awaited<ReturnType<typeof employeeProfile>>;
