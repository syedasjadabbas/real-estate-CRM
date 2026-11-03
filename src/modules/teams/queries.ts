import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { auditLogs, dailyReportLines, dailyReports, rosterEntries, teamMembers, teams, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { businessToday } from "@/modules/bookings/today";
import { parseTask as parse } from "@/modules/tasks/support";
import { loadTeam } from "./commands";
import { addDays, dailyReportEditable, monthDays, rosterEditable } from "./dates";
import { canManageTeams, canOperateTeam, canViewOwnRoster, canViewTeam, canViewTeams, seesAllTeams } from "./policy";
import { ROSTER_STATUSES, dateParam, monthParam, reportRangeSchema, type RosterStatus } from "./validation";

const manager = alias(users, "manager");
const submitter = alias(users, "submitter");

/** Teams the actor may see: all (admins, HR) or the ones they manage (managers). */
export async function visibleTeams(db: Database, actor: Actor) {
  if (!canViewTeams(actor)) throw forbidden();
  const where = seesAllTeams(actor) ? undefined : actor.managedTeamIds.length ? inArray(teams.id, actor.managedTeamIds) : sql`false`;
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      isActive: teams.isActive,
      weekendDays: teams.weekendDays,
      region: teams.region,
      managerId: teams.managerId,
      managerName: manager.name,
      members: sql<number>`(select count(*)::int from ${teamMembers} where ${teamMembers.teamId} = ${teams.id})`,
      updatedAt: teams.updatedAt,
    })
    .from(teams)
    .leftJoin(manager, eq(manager.id, teams.managerId))
    .where(where)
    .orderBy(desc(teams.isActive), asc(sql`lower(${teams.name})`));
  return rows;
}
export type TeamRow = Awaited<ReturnType<typeof visibleTeams>>[number];

/** Observed tiles: Teams "In directory", Active "Assignable", Inactive "Hidden from assignment", Members "Across all teams". */
export async function teamTiles(db: Database, actor: Actor) {
  const rows = await visibleTeams(db, actor);
  const ids = rows.map((r) => r.id);
  const [{ n }] = ids.length
    ? await db.select({ n: sql<number>`count(distinct ${teamMembers.userId})::int` }).from(teamMembers).where(inArray(teamMembers.teamId, ids))
    : [{ n: 0 }];
  return { teams: rows.length, active: rows.filter((r) => r.isActive).length, inactive: rows.filter((r) => !r.isActive).length, members: n };
}

/** Members of one team plus its recent audit trail. */
export async function teamDetail(db: Database, actor: Actor, teamId: string) {
  const team = await loadTeam(db, teamId);
  if (!canViewTeam(actor, team.id)) throw forbidden();
  const actorUser = alias(users, "audit_actor");
  const [members, history] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, role: users.role, status: users.status })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, team.id))
      .orderBy(asc(users.name)),
    db
      .select({ id: auditLogs.id, action: auditLogs.action, before: auditLogs.before, after: auditLogs.after, createdAt: auditLogs.createdAt, actorName: actorUser.name })
      .from(auditLogs)
      .leftJoin(actorUser, eq(actorUser.id, auditLogs.actorId))
      .where(and(eq(auditLogs.entity, "team"), eq(auditLogs.entityId, team.id)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(20),
  ]);
  return { team, members, history, canManage: canManageTeams(actor) };
}

/** Managers (for the team form) and candidate members (active agents and managers). */
export async function teamFormOptions(db: Database, actor: Actor) {
  if (!canManageTeams(actor)) throw forbidden();
  const people = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.status, "active"), inArray(users.role, ["agent", "manager"])))
    .orderBy(asc(users.name));
  return { managers: people.filter((p) => p.role === "manager"), candidates: people };
}

/** FR-121: one team's report for a date, with a line per current agent member. */
export async function getDailyReport(db: Database, actor: Actor, teamId: string, rawDate: string, now = new Date()) {
  const date = parse(dateParam, rawDate);
  const team = await loadTeam(db, teamId);
  if (!canViewTeam(actor, team.id)) throw forbidden();
  const [agents, [report]] = await Promise.all([
    db
      .select({ id: users.id, name: users.name })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(and(eq(teamMembers.teamId, team.id), eq(users.role, "agent")))
      .orderBy(asc(users.name)),
    db
      .select({ id: dailyReports.id, updatedAt: dailyReports.updatedAt, submittedBy: submitter.name })
      .from(dailyReports)
      .leftJoin(submitter, eq(submitter.id, dailyReports.submittedById))
      .where(and(eq(dailyReports.teamId, team.id), eq(dailyReports.reportDate, date))),
  ]);
  const lines = report ? await db.select().from(dailyReportLines).where(eq(dailyReportLines.dailyReportId, report.id)) : [];
  // Agents who left the team keep their saved line in the report.
  const departed = lines.filter((l) => !agents.some((a) => a.id === l.agentId)).map((l) => l.agentId);
  const departedNames = departed.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, departed)) : [];
  const rows = [...agents, ...departedNames].map((a) => {
    const l = lines.find((x) => x.agentId === a.id);
    return { agentId: a.id, name: a.name, inTeam: agents.some((x) => x.id === a.id), leads: l?.leads ?? 0, calls: l?.calls ?? 0, meetings: l?.meetings ?? 0, tokens: l?.tokens ?? 0, bookings: l?.bookings ?? 0, remarks: l?.remarks ?? "" };
  });
  return {
    team: { id: team.id, name: team.name },
    date,
    submitted: report ? { by: report.submittedBy, at: report.updatedAt } : null,
    rows,
    canEdit: canOperateTeam(actor, team.id) && dailyReportEditable(date, now),
    lockedReason: dailyReportEditable(date, now) ? null : "Daily reports can only be entered or changed on the report date.",
  };
}

/** Date-wise submissions (admins: all teams; managers: their own). Default range: the last 15 days. */
export async function listDailyReports(db: Database, actor: Actor, rawQuery: unknown, now = new Date()) {
  if (!canViewTeams(actor)) throw forbidden();
  const q = reportRangeSchema.parse(rawQuery ?? {});
  const to = q.to ?? businessToday(now);
  const from = q.from ?? addDays(to, -14);
  const scope = seesAllTeams(actor) ? undefined : actor.managedTeamIds.length ? inArray(dailyReports.teamId, actor.managedTeamIds) : sql`false`;
  const rows = await db
    .select({
      id: dailyReports.id,
      teamId: dailyReports.teamId,
      teamName: teams.name,
      date: dailyReports.reportDate,
      submittedBy: submitter.name,
      updatedAt: dailyReports.updatedAt,
      agents: sql<number>`count(${dailyReportLines.id})::int`,
      leads: sql<number>`coalesce(sum(${dailyReportLines.leads}), 0)::int`,
      calls: sql<number>`coalesce(sum(${dailyReportLines.calls}), 0)::int`,
      meetings: sql<number>`coalesce(sum(${dailyReportLines.meetings}), 0)::int`,
      tokens: sql<number>`coalesce(sum(${dailyReportLines.tokens}), 0)::int`,
      bookings: sql<number>`coalesce(sum(${dailyReportLines.bookings}), 0)::int`,
    })
    .from(dailyReports)
    .innerJoin(teams, eq(teams.id, dailyReports.teamId))
    .leftJoin(submitter, eq(submitter.id, dailyReports.submittedById))
    .leftJoin(dailyReportLines, eq(dailyReportLines.dailyReportId, dailyReports.id))
    .where(and(scope, gte(dailyReports.reportDate, from), lte(dailyReports.reportDate, to), q.team ? eq(dailyReports.teamId, q.team) : undefined))
    .groupBy(dailyReports.id, teams.name, submitter.name)
    .orderBy(desc(dailyReports.reportDate), asc(teams.name));
  return { from, to, team: q.team ?? null, rows };
}

function counts(statuses: (RosterStatus | null)[]) {
  return Object.fromEntries(ROSTER_STATUSES.map((s) => [s, statuses.filter((x) => x === s).length])) as Record<RosterStatus, number>;
}

/** FR-122 Day view: each member's status for a date, the counters and whether it is still editable. */
export async function getRosterDay(db: Database, actor: Actor, teamId: string, rawDate: string, now = new Date()) {
  const date = parse(dateParam, rawDate);
  const team = await loadTeam(db, teamId);
  if (!canViewTeam(actor, team.id)) throw forbidden();
  const members = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, team.id))
    .orderBy(asc(users.name));
  const entries = members.length
    ? await db.select().from(rosterEntries).where(and(inArray(rosterEntries.userId, members.map((m) => m.id)), eq(rosterEntries.date, date)))
    : [];
  const rows = members.map((m) => ({ ...m, status: (entries.find((e) => e.userId === m.id)?.status ?? null) as RosterStatus | null }));
  const editable = rosterEditable(date, now);
  return {
    team: { id: team.id, name: team.name, weekendDays: team.weekendDays },
    date,
    rows,
    counts: counts(rows.map((r) => r.status)),
    canEdit: canOperateTeam(actor, team.id) && editable,
    locked: !editable,
  };
}

/** FR-122 Month view: members × days. */
export async function getRosterMonth(db: Database, actor: Actor, teamId: string, rawMonth: string) {
  const month = parse(monthParam, rawMonth);
  const team = await loadTeam(db, teamId);
  if (!canViewTeam(actor, team.id)) throw forbidden();
  const days = monthDays(month);
  const members = await db
    .select({ id: users.id, name: users.name })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, team.id))
    .orderBy(asc(users.name));
  const entries = members.length
    ? await db
        .select({ userId: rosterEntries.userId, date: rosterEntries.date, status: rosterEntries.status })
        .from(rosterEntries)
        .where(and(inArray(rosterEntries.userId, members.map((m) => m.id)), gte(rosterEntries.date, days[0]), lte(rosterEntries.date, days[days.length - 1])))
    : [];
  return {
    team: { id: team.id, name: team.name, weekendDays: team.weekendDays },
    month,
    days,
    rows: members.map((m) => ({ ...m, byDay: Object.fromEntries(entries.filter((e) => e.userId === m.id).map((e) => [e.date, e.status])) as Record<string, RosterStatus> })),
  };
}

/** "R (own roster)": an agent's own entries for a month. */
export async function myRoster(db: Database, actor: Actor, rawMonth: string) {
  if (!canViewOwnRoster(actor)) throw forbidden();
  const month = parse(monthParam, rawMonth);
  const days = monthDays(month);
  const entries = await db
    .select({ date: rosterEntries.date, status: rosterEntries.status, teamName: teams.name })
    .from(rosterEntries)
    .innerJoin(teams, eq(teams.id, rosterEntries.teamId))
    .where(and(eq(rosterEntries.userId, actor.id), gte(rosterEntries.date, days[0]), lte(rosterEntries.date, days[days.length - 1])))
    .orderBy(asc(rosterEntries.date));
  return { month, days, entries, counts: counts(entries.map((e) => e.status)) };
}

