import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { businessToday } from "@/modules/bookings/today";
import type { Database } from "@/server/db";
import {
  appSettings,
  auditLogs,
  followUps,
  leadAssignments,
  leads,
  leaveRequests,
  rosterEntries,
  rotationState,
  sessions,
  teamMembers,
  teams,
  users,
} from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden } from "@/server/errors";
import {
  agentScore,
  availabilityScore,
  conversionScore,
  DEFAULT_ASSIGNMENT_SETTINGS,
  inWorkingHours,
  performanceScore,
  pickCandidate,
  weightedScore,
  workloadScore,
  type AgentStats,
  type AssignmentSettings,
  type Candidate,
} from "./assignment-score";
import type { Tx } from "./support";

type Db = Database | Tx;

/**
 * Awaits query builders one after another. Drizzle builders only run when awaited, and a
 * transaction's single connection must not be asked to run several queries at once.
 */
async function inOrder<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  const out: unknown[] = [];
  for (const v of values) out.push(await v);
  return out as { -readonly [P in keyof T]: Awaited<T[P]> };
}

const KEYS: Record<keyof AssignmentSettings, string> = {
  weightWorkload: "assignment.weight_workload",
  weightPerformance: "assignment.weight_performance",
  weightConversion: "assignment.weight_conversion",
  weightAvailability: "assignment.weight_availability",
  maxLoad: "assignment.max_load",
  minDecidedLeads: "assignment.min_decided_leads",
  minPerformanceSample: "assignment.min_performance_sample",
  lookbackDays: "assignment.lookback_days",
  onlineMinutes: "assignment.online_minutes",
  offlineAvailability: "assignment.offline_availability",
  workStart: "assignment.work_start",
  workEnd: "assignment.work_end",
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, 24-hour");
const weight = z.coerce.number().int("Use a whole number").min(0).max(100);
export const assignmentSettingsSchema = z
  .object({
    weightWorkload: weight,
    weightPerformance: weight,
    weightConversion: weight,
    weightAvailability: weight,
    maxLoad: z.coerce.number().int().min(1).max(10_000),
    minDecidedLeads: z.coerce.number().int().min(1).max(1_000),
    minPerformanceSample: z.coerce.number().int().min(1).max(1_000),
    lookbackDays: z.coerce.number().int().min(7).max(730),
    onlineMinutes: z.coerce.number().int().min(1).max(1_440),
    offlineAvailability: z.coerce.number().min(0).max(1),
    workStart: hhmm,
    workEnd: hhmm,
  })
  .refine((s) => s.weightWorkload + s.weightPerformance + s.weightConversion + s.weightAvailability === 100, {
    message: "The four weights must add up to 100",
    path: ["weightWorkload"],
  });

export async function readAssignmentSettings(db: Db): Promise<AssignmentSettings> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, Object.values(KEYS)));
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const merged = Object.fromEntries(
    (Object.keys(KEYS) as (keyof AssignmentSettings)[]).map((k) => [k, stored[KEYS[k]] ?? String(DEFAULT_ASSIGNMENT_SETTINGS[k])]),
  );
  const parsed = assignmentSettingsSchema.safeParse(merged);
  // A broken stored value never stops leads being created: the defaults apply instead.
  return parsed.success ? parsed.data : DEFAULT_ASSIGNMENT_SETTINGS;
}

export const canManageAssignment = (actor: Pick<Actor, "role">) => actor.role === "super_admin" || actor.role === "admin";

export async function updateAssignmentSettings(db: Database, actor: Actor, input: unknown) {
  if (!canManageAssignment(actor)) throw forbidden();
  const parsed = assignmentSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const fields = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "form"), i.message]));
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields });
  }
  return db.transaction(async (tx) => {
    const before = await readAssignmentSettings(tx);
    for (const k of Object.keys(KEYS) as (keyof AssignmentSettings)[]) {
      await tx
        .insert(appSettings)
        .values({ key: KEYS[k], value: String(parsed.data[k]), updatedById: actor.id })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: String(parsed.data[k]), updatedById: actor.id, updatedAt: new Date() } });
    }
    await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "assignment.settings", entity: "app_settings", entityId: "assignment", before, after: parsed.data });
    return parsed.data;
  });
}

const zero = (): AgentStats => ({ openLeads: 0, pendingFollowUps: 0, followUpsDue: 0, followUpsDone: 0, leadsToTouch: 0, touchedWithinDay: 0, booked: 0, lost: 0, online: false });

/** The counts behind every agent score, from the live records. */
export async function agentStats(db: Db, userIds: string[], s: AssignmentSettings, now = new Date()) {
  const stats = new Map(userIds.map((id) => [id, zero()]));
  if (userIds.length === 0) return stats;
  const since = new Date(now.getTime() - s.lookbackDays * 86_400_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const soon = new Date(now.getTime() + 7 * 86_400_000);
  const [open, pending, fu, touch, outcome, online] = await inOrder([
    db
      .select({ id: leads.ownerId, n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(inArray(leads.ownerId, userIds), isNull(leads.deletedAt), notInArray(leads.stage, ["booked", "lost_lead"])))
      .groupBy(leads.ownerId),
    db
      .select({ id: followUps.assigneeId, n: sql<number>`count(*)::int` })
      .from(followUps)
      .where(and(inArray(followUps.assigneeId, userIds), eq(followUps.status, "pending"), lte(followUps.dueAt, soon)))
      .groupBy(followUps.assigneeId),
    db
      .select({
        id: followUps.assigneeId,
        due: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${followUps.status} = 'done')::int`,
      })
      .from(followUps)
      .where(and(inArray(followUps.assigneeId, userIds), sql`${followUps.status} <> 'cancelled'`, gte(followUps.dueAt, since), lt(followUps.dueAt, now)))
      .groupBy(followUps.assigneeId),
    db
      .select({
        id: leads.ownerId,
        n: sql<number>`count(*)::int`,
        fast: sql<number>`count(*) filter (where ${leads.firstTouchAt} is not null and ${leads.firstTouchAt} - ${leads.createdAt} <= interval '1 day')::int`,
      })
      .from(leads)
      .where(and(inArray(leads.ownerId, userIds), isNull(leads.deletedAt), gte(leads.createdAt, since), lt(leads.createdAt, dayAgo)))
      .groupBy(leads.ownerId),
    db
      .select({
        id: leads.ownerId,
        booked: sql<number>`count(*) filter (where ${leads.stage} = 'booked')::int`,
        lost: sql<number>`count(*) filter (where ${leads.stage} = 'lost_lead')::int`,
      })
      .from(leads)
      .where(and(inArray(leads.ownerId, userIds), isNull(leads.deletedAt), gte(leads.createdAt, since)))
      .groupBy(leads.ownerId),
    db
      .selectDistinct({ id: sessions.userId })
      .from(sessions)
      .where(and(inArray(sessions.userId, userIds), gt(sessions.expiresAt, now), gte(sessions.lastSeenAt, new Date(now.getTime() - s.onlineMinutes * 60_000)))),
  ]);
  const at = (id: string | null) => (id ? stats.get(id) : undefined);
  for (const r of open) if (at(r.id)) at(r.id)!.openLeads = r.n;
  for (const r of pending) if (at(r.id)) at(r.id)!.pendingFollowUps = r.n;
  for (const r of fu) if (at(r.id)) Object.assign(at(r.id)!, { followUpsDue: r.due, followUpsDone: r.done });
  for (const r of touch) if (at(r.id)) Object.assign(at(r.id)!, { leadsToTouch: r.n, touchedWithinDay: r.fast });
  for (const r of outcome) if (at(r.id)) Object.assign(at(r.id)!, { booked: r.booked, lost: r.lost });
  for (const r of online) if (at(r.id)) at(r.id)!.online = true;
  return stats;
}

/** Agent scores for display (My Teams, dashboard). */
export async function agentScores(db: Db, userIds: string[], now = new Date()) {
  const s = await readAssignmentSettings(db);
  const stats = await agentStats(db, userIds, s, now);
  return new Map(userIds.map((id) => [id, { ...agentScore(stats.get(id)!, s), ...stats.get(id)! }]));
}

export type AssignmentDecision = {
  ownerId: string | null;
  reason: string;
  breakdown: Record<string, unknown>;
};

/**
 * Picks an owner for a new lead in `projectId`. Eligible: active agents in active teams (a
 * manager's own teams when a manager creates the lead), not on approved leave today, not marked
 * on leave or "leads off" in today's roster, not on their team's weekend without a roster entry,
 * and below the maximum load. Among those, the highest weighted score wins. Runs under the
 * project's assignment lock so two simultaneous leads see each other's load.
 */
export async function chooseOwner(tx: Tx, actor: Actor, projectId: string, now = new Date()): Promise<AssignmentDecision> {
  const s = await readAssignmentSettings(tx);
  await tx.insert(rotationState).values({ projectId }).onConflictDoNothing();
  await tx.select().from(rotationState).where(eq(rotationState.projectId, projectId)).for("update");

  const today = businessToday(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const managedOnly = actor.role === "manager";
  // Share-lock the teams being considered: a team change in progress (which takes the team row's
  // update lock) finishes first, so an agent being removed can't be handed the lead (F-15).
  await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.isActive, true), managedOnly ? eq(teams.managerId, actor.id) : undefined))
    .orderBy(asc(teams.id))
    .for("share");
  const members = await tx
    .select({ id: users.id, name: users.name, weekendDays: teams.weekendDays })
    .from(users)
    .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(users.role, "agent"), eq(users.status, "active"), eq(teams.isActive, true), managedOnly ? eq(teams.managerId, actor.id) : undefined))
    .orderBy(asc(users.id));
  const agents = new Map<string, { name: string; weekend: boolean }>();
  for (const m of members) {
    const weekend = m.weekendDays.includes(weekday);
    const prior = agents.get(m.id);
    // On weekend only if every team they are in has today as a weekend day.
    agents.set(m.id, { name: m.name, weekend: prior ? prior.weekend && weekend : weekend });
  }
  const ids = [...agents.keys()];
  const excluded: { userId: string; name: string; reason: string }[] = [];
  if (ids.length === 0) return { ownerId: null, reason: "No active agents in an active team", breakdown: { settings: s, candidates: [], excluded } };

  const [onLeave, roster, lastAssigned] = await inOrder([
    tx
      .selectDistinct({ id: leaveRequests.userId })
      .from(leaveRequests)
      .where(and(inArray(leaveRequests.userId, ids), inArray(leaveRequests.status, ["approved", "cancel_requested"]), lte(leaveRequests.startDate, today), gte(leaveRequests.endDate, today))),
    tx.select({ id: rosterEntries.userId, status: rosterEntries.status }).from(rosterEntries).where(and(inArray(rosterEntries.userId, ids), eq(rosterEntries.date, today))),
    tx
      .select({ id: leadAssignments.assigneeId, at: sql<string>`max(${leadAssignments.createdAt})` })
      .from(leadAssignments)
      .where(inArray(leadAssignments.assigneeId, ids))
      .groupBy(leadAssignments.assigneeId),
  ]);
  const leave = new Set(onLeave.map((r) => r.id));
  const rosterBy = new Map(roster.map((r) => [r.id, r.status]));
  const lastBy = new Map(lastAssigned.map((r) => [r.id, new Date(r.at).getTime()]));
  const stats = await agentStats(tx, ids, s, now);
  const hours = inWorkingHours(now, s.workStart, s.workEnd);

  const candidates: Candidate[] = [];
  for (const id of ids) {
    const a = agents.get(id)!;
    const st = stats.get(id)!;
    const status = rosterBy.get(id);
    const load = st.openLeads + st.pendingFollowUps;
    let why: string | null = null;
    if (leave.has(id) || status === "on_leave") why = "On leave today";
    else if (status === "leads_off") why = "Leads off in today's roster";
    else if (!status && a.weekend) why = "Team weekend";
    else if (load >= s.maxLoad) why = `Full: ${load} of ${s.maxLoad} open leads and follow-ups`;
    if (why) {
      excluded.push({ userId: id, name: a.name, reason: why });
      continue;
    }
    const components = {
      workload: workloadScore(load, s.maxLoad),
      performance: performanceScore(st, s.minPerformanceSample),
      conversion: conversionScore(st.booked, st.lost, s.minDecidedLeads),
      availability: availabilityScore(st.online, hours, s.offlineAvailability),
    };
    candidates.push({ userId: id, name: a.name, load, lastAssignedAt: lastBy.get(id) ?? null, components, score: weightedScore(components, s) });
  }
  const winner = pickCandidate(candidates);
  const breakdown = {
    settings: s,
    inWorkingHours: hours,
    candidates: candidates.map((c) => ({ userId: c.userId, name: c.name, load: c.load, score: c.score, ...c.components })).sort((a, b) => b.score - a.score),
    excluded,
  };
  if (!winner) return { ownerId: null, reason: "No eligible agent: every agent is unavailable or full", breakdown };
  return {
    ownerId: winner.userId,
    reason: `Highest assignment score ${Math.round(winner.score * 100)} of ${candidates.length} eligible agent${candidates.length === 1 ? "" : "s"}`,
    breakdown,
  };
}

/** Writes one ownership decision to the assignment history. */
export async function recordAssignment(
  tx: Tx,
  row: { leadId: string; assigneeId: string | null; previousOwnerId?: string | null; mode: (typeof leadAssignments.$inferInsert)["mode"]; reason: string; breakdown?: unknown; actorId: string | null },
) {
  await tx.insert(leadAssignments).values({ ...row, previousOwnerId: row.previousOwnerId ?? null, breakdown: row.breakdown ?? null });
}

/**
 * Team performance, 0–100: the average of its active agents' scores (the same score My Teams shows).
 * Teams in the actor's view: everyone's for admins, their own for managers, their teams for agents.
 */
export async function teamScores(db: Db, actor: Actor, now = new Date()) {
  const teamRows = await db
    .select({ teamId: teams.id, teamName: teams.name, userId: users.id, managerId: teams.managerId })
    .from(teams)
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teams.isActive, true), eq(users.role, "agent"), eq(users.status, "active")));
  const visible = teamRows.filter((r) =>
    actor.role === "super_admin" || actor.role === "admin" ? true : actor.role === "manager" ? r.managerId === actor.id : teamRows.some((m) => m.teamId === r.teamId && m.userId === actor.id),
  );
  const scores = await agentScores(db, [...new Set(visible.map((r) => r.userId))], now);
  const byTeam = new Map<string, { id: string; label: string; members: number[] }>();
  for (const r of visible) {
    const t = byTeam.get(r.teamId) ?? { id: r.teamId, label: r.teamName, members: [] };
    t.members.push(scores.get(r.userId)!.score);
    byTeam.set(r.teamId, t);
  }
  return [...byTeam.values()]
    .map((t) => ({ id: t.id, label: t.label, count: Math.round(t.members.reduce((a, b) => a + b, 0) / t.members.length) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
