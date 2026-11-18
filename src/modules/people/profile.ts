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
import { bookings, employeeNotes, employeeProfiles, files, followUps, leadActivities, leadSources, leads, lostReasons, meetings, teamMembers, teams, users } from "@/server/db/schema";
import { addDays } from "@/modules/teams/dates";
import { forbidden, notFound } from "@/server/errors";
import { z } from "zod";

/**
 * An employee's full profile for Admins and Super Admins (owner, 15 Nov 2026): one page with
 * everything about an agent's work. Range figures (calls, follow-ups, meetings, bookings, leads
 * assigned) use the chosen dates, exactly as Performance does; the pipeline, follow-ups due now,
 * attendance and leave are current.
 */
export const canViewProfiles = (actor: Pick<Actor, "role">) => actor.role === "admin" || actor.role === "super_admin" || actor.role === "hr";

/**
 * HR opens work profiles read-only (owner, 18 Nov 2026): the figures, pipeline counts, targets and
 * attendance, but no lead-level detail (customer names in calls, overdue follow-ups, activity) and no
 * coaching notes. Admins and Super Admins see everything.
 */
export const canSeeLeadDetail = (actor: Pick<Actor, "role">) => actor.role === "admin" || actor.role === "super_admin";
export const canSeeCoachingNotes = canSeeLeadDetail;

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

  const leadDetail = canSeeLeadDetail(actor);
  const recordings = !leadDetail ? [] : await db
    .select({ id: files.id, name: files.originalName, durationSec: files.durationSec, createdAt: files.createdAt, leadId: leads.id, leadName: leads.name, leadCode: leads.code })
    .from(files)
    .innerJoin(leads, eq(leads.id, files.leadId))
    .where(and(eq(files.uploadedById, userId), eq(files.kind, "call_recording"), isNull(files.deletedAt), gte(files.createdAt, range.window.start), lt(files.createdAt, range.window.end)))
    .orderBy(desc(files.createdAt))
    .limit(200);

  const activity = !leadDetail ? [] : await db
    .select({ id: leadActivities.id, type: leadActivities.type, data: leadActivities.data, createdAt: leadActivities.createdAt, leadId: leads.id, leadName: leads.name, leadCode: leads.code })
    .from(leadActivities)
    .innerJoin(leads, eq(leads.id, leadActivities.leadId))
    .where(and(eq(leadActivities.actorId, userId), isNull(leads.deletedAt)))
    .orderBy(desc(leadActivities.createdAt))
    .limit(200);

  const targetRows = await currentTargets(db, userId, now);
  const targetLines = (p: "daily" | "weekly" | "monthly") => {
    const t = targetRows.find((x) => x.period === p);
    return TARGET_METRICS.map((m) => ({ label: m.label, actual: t?.achieved[m.key] ?? 0, target: t?.goals?.[m.key] || null, met: Boolean(t?.met.includes(m.key)) }));
  };

  // ── Extras (owner, 16 Nov 2026) ──
  // The same length of time just before the chosen dates, for ↑ / ↓ on the top cards.
  const spanDays = Math.round((range.window.end.getTime() - range.window.start.getTime()) / 86_400_000);
  const prevWindow = { start: new Date(range.window.start.getTime() - spanDays * 86_400_000), end: range.window.start };
  const [prevMetrics] = await agentMetrics(db, [{ id: person.id, name: person.name }], prevWindow);
  const [prevBk] = await db
    .select({ made: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.agentId, userId), ne(bookings.stage, "cancelled"), gte(bookings.createdAt, prevWindow.start), lt(bookings.createdAt, prevWindow.end)));

  // Team comparison: the active agents of the person's first team, same dates.
  const team = teamRows.find((t) => t.isActive) ?? null;
  let teamCompare: { team: string; size: number; avg: { calls: number; meetings: number; winPct: number | null; booked: number }; rank: number } | null = null;
  if (team) {
    const mates = await db
      .select({ id: users.id, name: users.name })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(and(eq(teamMembers.teamId, team.id), eq(users.role, "agent"), eq(users.status, "active")));
    if (mates.length > 1 && mates.some((x) => x.id === userId)) {
      const all = await agentMetrics(db, mates, range.window);
      const avg = (k: "calls" | "meetings" | "booked") => Math.round((all.reduce((n, r) => n + r[k], 0) / all.length) * 10) / 10;
      const decided = all.reduce((n, r) => n + r.booked + r.lost, 0);
      const ranked = [...all].sort((x, y) => y.booked - x.booked || y.meetings - x.meetings || y.calls - x.calls);
      teamCompare = {
        team: team.name,
        size: all.length,
        avg: { calls: avg("calls"), meetings: avg("meetings"), booked: avg("booked"), winPct: decided ? Math.round((all.reduce((n, r) => n + r.booked, 0) / decided) * 100) : null },
        rank: ranked.findIndex((r) => r.userId === userId) + 1,
      };
    }
  }

  const overdueList = !leadDetail ? [] : await db
    .select({ id: followUps.id, dueAt: followUps.dueAt, note: followUps.note, leadId: leads.id, leadName: leads.name, leadCode: leads.code })
    .from(followUps)
    .innerJoin(leads, eq(leads.id, followUps.leadId))
    .where(and(eq(followUps.assigneeId, userId), eq(followUps.status, "pending"), lt(followUps.dueAt, now), isNull(leads.deletedAt)))
    .orderBy(asc(followUps.dueAt))
    .limit(200);

  const lostByReason = await db
    .select({ reasonId: leads.lostReasonId, reason: lostReasons.name, n: sql<number>`count(*)::int` })
    .from(leads)
    .leftJoin(lostReasons, eq(lostReasons.id, leads.lostReasonId))
    .where(and(eq(leads.ownerId, userId), eq(leads.stage, "lost_lead"), isNull(leads.deletedAt), gte(leads.stageChangedAt, range.window.start), lt(leads.stageChangedAt, range.window.end)))
    .groupBy(leads.lostReasonId, lostReasons.name)
    .orderBy(desc(sql`count(*)`));

  const bySource = await db
    .select({
      sourceId: leadSources.id,
      source: leadSources.name,
      leads: sql<number>`count(*)::int`,
      won: sql<number>`count(*) filter (where ${leads.stage} = 'booked')::int`,
      lost: sql<number>`count(*) filter (where ${leads.stage} = 'lost_lead')::int`,
    })
    .from(leads)
    .innerJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .where(and(eq(leads.ownerId, userId), isNull(leads.deletedAt), gte(leads.createdAt, range.window.start), lt(leads.createdAt, range.window.end)))
    .groupBy(leadSources.id, leadSources.name)
    .orderBy(desc(sql`count(*)`));

  // Calls and completed meetings per day (at most the last 31 days of the range).
  const chartFrom = spanDays > 31 ? addDays(range.to, -30) : range.from;
  const chartStart = new Date(`${chartFrom}T00:00:00+05:00`);
  const day = (col: unknown) => sql<string>`to_char((${col} at time zone 'Asia/Karachi')::date, 'YYYY-MM-DD')`;
  const [callDays, meetingDays] = await Promise.all([
    db
      .select({ d: day(files.createdAt), n: sql<number>`count(*)::int` })
      .from(files)
      .where(and(eq(files.uploadedById, userId), eq(files.kind, "call_recording"), isNull(files.deletedAt), gte(files.createdAt, chartStart), lt(files.createdAt, range.window.end)))
      .groupBy(sql`1`),
    db
      .select({ d: day(meetings.startsAt), n: sql<number>`count(*)::int` })
      .from(meetings)
      .where(and(eq(meetings.organizerId, userId), eq(meetings.status, "completed"), gte(meetings.startsAt, chartStart), lt(meetings.startsAt, range.window.end)))
      .groupBy(sql`1`),
  ]);
  const daily: { date: string; calls: number; meetings: number }[] = [];
  for (let d = chartFrom; d <= range.to; d = addDays(d, 1)) daily.push({ date: d, calls: callDays.find((x) => x.d === d)?.n ?? 0, meetings: meetingDays.find((x) => x.d === d)?.n ?? 0 });

  const author = users;
  // Private coaching notes are never shown to the person they are about (an Admin opening their own profile).
  const notes = userId === actor.id || !canSeeCoachingNotes(actor) ? [] : await db
    .select({ id: employeeNotes.id, body: employeeNotes.body, createdAt: employeeNotes.createdAt, authorId: employeeNotes.authorId, authorName: author.name })
    .from(employeeNotes)
    .leftJoin(author, eq(author.id, employeeNotes.authorId))
    .where(eq(employeeNotes.userId, userId))
    .orderBy(desc(employeeNotes.createdAt))
    .limit(30);

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
    previous: { from: addDays(range.from, -spanDays), to: addDays(range.from, -1), calls: prevMetrics.calls, callMin: prevMetrics.callMin, meetings: prevMetrics.meetings, bookingsMade: prevBk.made, winPct: prevMetrics.winPct },
    teamCompare,
    overdueList,
    asOf: now,
    lostByReason: lostByReason.map((r) => ({ reasonId: r.reasonId, reason: r.reason ?? "No reason given", count: r.n })),
    bySource,
    daily,
    notes,
    /** False for HR: lead names, call and activity lists and every link into sales pages are left out. */
    leadDetail,
  };
}

export type EmployeeProfile = Awaited<ReturnType<typeof employeeProfile>>;
