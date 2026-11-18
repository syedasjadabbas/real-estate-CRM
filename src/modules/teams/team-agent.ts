import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { myAttendance } from "@/modules/attendance/service";
import { businessToday } from "@/modules/bookings/today";
import { agentScores } from "@/modules/leads/assignment";
import { LEAD_STAGES, type LeadStage } from "@/modules/leads/constants";
import { agentMetrics } from "@/modules/performance/service";
import { resolveRange } from "@/modules/performance/range";
import { currentTargets } from "@/modules/targets/service";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { bookings, followUps, leads, teamMembers, teams, users } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/errors";
import { addDays } from "./dates";

/**
 * One agent's KPIs for their Team Lead (owner, 16 Nov 2026): a short, view-only page reached from
 * My team. Only for an active agent in a team the actor leads. Range figures follow the chosen dates
 * (as Performance does) with the same length of time before them for ↑ / ↓; the pipeline, overdue
 * follow-ups, targets and attendance are current. No coaching notes, phone or lead details: those
 * stay with Admins on the work profile.
 */
export async function teamAgentKpis(db: Database, actor: Actor, agentId: string, rawQuery: { from?: string; to?: string } = {}, now = new Date()) {
  const led = actor.ledTeamIds ?? [];
  if (actor.role !== "agent" || led.length === 0) throw forbidden("Only Team Leads have a team view.");
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) throw notFound("Agent");
  const [member] = await db
    .select({ id: users.id, name: users.name, teamId: teams.id, team: teams.name })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, agentId), inArray(teamMembers.teamId, led), eq(users.role, "agent"), eq(users.status, "active")))
    .limit(1);
  // Someone outside the teams the actor leads reads as not found (no existence leak).
  if (!member) throw notFound("Agent");

  const range = resolveRange(rawQuery.from, rawQuery.to, now);
  const today = businessToday(now);
  const todayEnd = new Date(new Date(`${today}T00:00:00+05:00`).getTime() + 86_400_000);
  const spanDays = Math.max(1, Math.round((range.window.end.getTime() - range.window.start.getTime()) / 86_400_000));
  const prevWindow = { start: new Date(range.window.start.getTime() - spanDays * 86_400_000), end: range.window.start };
  const person = { id: member.id, name: member.name };

  const mates = await db
    .select({ id: users.id, name: users.name })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, member.teamId), eq(users.role, "agent"), eq(users.status, "active")));

  const [[metrics], [prev], scores, targets, stageRows, [fu], [bk], teamAll, attendance] = await Promise.all([
    agentMetrics(db, [person], range.window),
    agentMetrics(db, [person], prevWindow),
    agentScores(db, [person.id], now),
    currentTargets(db, person.id, now),
    db
      .select({ stage: leads.stage, n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.ownerId, person.id), isNull(leads.deletedAt)))
      .groupBy(leads.stage),
    db
      .select({
        overdue: sql<number>`count(*) filter (where ${followUps.dueAt} < ${now})::int`,
        today: sql<number>`count(*) filter (where ${followUps.dueAt} >= ${now} and ${followUps.dueAt} < ${todayEnd})::int`,
      })
      .from(followUps)
      .where(and(eq(followUps.assigneeId, person.id), eq(followUps.status, "pending"))),
    db
      .select({
        made: sql<number>`count(*) filter (where ${bookings.createdAt} >= ${range.window.start} and ${bookings.createdAt} < ${range.window.end})::int`,
        won: sql<number>`count(*) filter (where ${bookings.stage} = 'confirmed' and ${bookings.stageChangedAt} >= ${range.window.start} and ${bookings.stageChangedAt} < ${range.window.end})::int`,
      })
      .from(bookings)
      .where(and(eq(bookings.agentId, person.id), ne(bookings.stage, "cancelled"))),
    agentMetrics(db, mates, range.window),
    myAttendance(db, { ...actor, id: person.id, role: "agent" } as Actor, now),
  ]);
  const score = scores.get(person.id) ?? null;
  const ranked = [...teamAll].sort((x, y) => y.booked - x.booked || y.meetings - x.meetings || y.calls - x.calls);
  const avg = (k: "calls" | "meetings" | "booked") => (teamAll.length ? Math.round((teamAll.reduce((n, r) => n + r[k], 0) / teamAll.length) * 10) / 10 : 0);

  return {
    person,
    team: { id: member.teamId, name: member.team, size: teamAll.length, rank: ranked.findIndex((r) => r.userId === person.id) + 1, avg: { calls: avg("calls"), meetings: avg("meetings"), booked: avg("booked") } },
    range: { from: range.from, to: range.to },
    today,
    previous: { from: addDays(range.from, -spanDays), to: addDays(range.from, -1), calls: prev.calls, meetings: prev.meetings, booked: prev.booked, winPct: prev.winPct, fuPct: prev.fuPct },
    metrics,
    score,
    pipeline: LEAD_STAGES.map((s) => ({ stage: s as LeadStage, count: stageRows.find((r) => r.stage === s)?.n ?? 0 })),
    followUps: { overdue: fu.overdue, today: fu.today },
    bookings: { made: bk.made, won: bk.won },
    targets: targets.filter((t) => t.goals),
    attendance: { status: attendance.status, checkIn: attendance.checkIn, month: attendance.month },
  };
}
export type TeamAgentKpis = Awaited<ReturnType<typeof teamAgentKpis>>;

