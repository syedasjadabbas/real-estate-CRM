import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, dailyReportLines, dailyReports, rosterEntries, teamMembers, teams, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import type { DbOrTx } from "@/modules/leads/support";
import { parseTask as parse, taskFieldError as fieldError } from "@/modules/tasks/support";
import { dailyReportEditable, rosterEditable } from "./dates";
import { assertCanManageTeams, canOperateTeam } from "./policy";
import { createTeamSchema, dailyReportSchema, dateParam, membersSchema, rosterSchema, updateTeamSchema } from "./validation";

async function audit(tx: DbOrTx, actor: Actor, action: string, entity: string, entityId: string, before: unknown, after: unknown) {
  await tx.insert(auditLogs).values({ actorId: actor.id, action, entity, entityId, before: before ?? null, after: after ?? null });
}

export async function loadTeam(tx: DbOrTx, teamId: string, forUpdate = false) {
  if (!/^[0-9a-f-]{36}$/i.test(teamId)) throw notFound("Team");
  const query = tx.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  const [team] = forUpdate ? await query.for("update") : await query;
  if (!team) throw notFound("Team");
  return team;
}

/** Team managers must be active users with role manager (T-A2). */
async function checkManager(tx: DbOrTx, managerId: string) {
  const [u] = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, managerId)).limit(1);
  if (!u || u.status !== "active" || u.role !== "manager") throw fieldError("managerId", "Choose an active sales manager");
}

async function checkNameFree(tx: DbOrTx, name: string, exceptId?: string) {
  const [clash] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(sql`lower(${teams.name}) = lower(${name})`)
    .limit(1);
  if (clash && clash.id !== exceptId) throw fieldError("name", "A team with this name already exists");
}

/** FR-120 create (admins). */
export async function createTeam(db: Database, actor: Actor, input: unknown) {
  assertCanManageTeams(actor);
  const data = parse(createTeamSchema, input);
  return db.transaction(async (tx) => {
    await checkNameFree(tx, data.name);
    if (data.managerId) await checkManager(tx, data.managerId);
    const [team] = await tx.insert(teams).values({ name: data.name, managerId: data.managerId, isActive: data.isActive, weekendDays: data.weekendDays, region: data.region ?? null }).returning({ id: teams.id });
    await audit(tx, actor, "team.create", "team", team.id, null, data);
    return { teamId: team.id };
  });
}

/** Name, manager, active flag, weekend days (Q9). Inactive teams are hidden from rotation (FR-120); never deleted (T-A3). */
export async function updateTeam(db: Database, actor: Actor, teamId: string, input: unknown) {
  assertCanManageTeams(actor);
  const data = parse(updateTeamSchema, input);
  return db.transaction(async (tx) => {
    const team = await loadTeam(tx, teamId, true);
    const next = {
      name: data.name ?? team.name,
      managerId: "managerId" in data ? (data.managerId ?? null) : team.managerId,
      isActive: data.isActive ?? team.isActive,
      weekendDays: data.weekendDays ?? team.weekendDays,
      region: "region" in data ? (data.region ?? null) : team.region,
    };
    if (next.name !== team.name) await checkNameFree(tx, next.name, team.id);
    if (next.managerId && next.managerId !== team.managerId) await checkManager(tx, next.managerId);
    const changed = (["name", "managerId", "isActive", "weekendDays", "region"] as const).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(team[k]));
    if (changed.length === 0) return { changed: [] as string[] };
    await tx.update(teams).set({ ...next, updatedAt: new Date() }).where(eq(teams.id, team.id));
    await audit(
      tx,
      actor,
      "team.update",
      "team",
      team.id,
      Object.fromEntries(changed.map((k) => [k, team[k]])),
      Object.fromEntries(changed.map((k) => [k, next[k]])),
    );
    return { changed };
  });
}

/** Replaces the member list. Members must be active agents or managers (T-A2). */
export async function setTeamMembers(db: Database, actor: Actor, teamId: string, input: unknown) {
  assertCanManageTeams(actor);
  const { userIds } = parse(membersSchema, input);
  const wanted = [...new Set(userIds)];
  return db.transaction(async (tx) => {
    const team = await loadTeam(tx, teamId, true);
    if (wanted.length) {
      const rows = await tx.select({ id: users.id, role: users.role, status: users.status }).from(users).where(inArray(users.id, wanted));
      const ok = rows.filter((u) => u.status === "active" && (u.role === "agent" || u.role === "manager"));
      if (ok.length !== wanted.length) throw fieldError("userIds", "Members must be active agents or managers");
    }
    const current = (await tx.select({ userId: teamMembers.userId }).from(teamMembers).where(eq(teamMembers.teamId, team.id))).map((r) => r.userId);
    const added = wanted.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !wanted.includes(id));
    if (added.length === 0 && removed.length === 0) return { added, removed };
    if (removed.length) await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, team.id), inArray(teamMembers.userId, removed)));
    if (added.length) await tx.insert(teamMembers).values(added.map((userId) => ({ teamId: team.id, userId })));
    await tx.update(teams).set({ updatedAt: new Date() }).where(eq(teams.id, team.id));
    await audit(tx, actor, "team.members", "team", team.id, { members: current }, { members: wanted, added, removed });
    return { added, removed };
  });
}

/** Current agent members of a team (the daily report covers agents, T-A5). */
export async function teamAgentIds(tx: DbOrTx, teamId: string) {
  const rows = await tx
    .select({ id: users.id })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), eq(users.role, "agent")));
  return rows.map((r) => r.id);
}

/**
 * FR-121 save (upsert): one report per team per date, editable on the report date only (T-A4).
 * Lines for agents not in the team are rejected; lines not sent are removed.
 */
export async function saveDailyReport(db: Database, actor: Actor, teamId: string, rawDate: string, input: unknown, now = new Date()) {
  const date = parse(dateParam, rawDate);
  const { lines } = parse(dailyReportSchema, input);
  return db.transaction(async (tx) => {
    const team = await loadTeam(tx, teamId);
    if (!canOperateTeam(actor, team.id)) throw forbidden();
    if (!dailyReportEditable(date, now)) throw new AppError("BUSINESS_RULE", "Daily reports can only be entered or changed on the report date.");
    const agents = await teamAgentIds(tx, team.id);
    const unknown = lines.find((l) => !agents.includes(l.agentId));
    if (unknown) throw fieldError("lines", "Every line must be for an agent in this team");
    if (new Set(lines.map((l) => l.agentId)).size !== lines.length) throw fieldError("lines", "Each agent can appear once");

    const [report] = await tx
      .insert(dailyReports)
      .values({ teamId: team.id, reportDate: date, submittedById: actor.id })
      .onConflictDoUpdate({ target: [dailyReports.teamId, dailyReports.reportDate], set: { submittedById: actor.id, updatedAt: new Date() } })
      .returning({ id: dailyReports.id, createdAt: dailyReports.createdAt, updatedAt: dailyReports.updatedAt });
    const before = await tx.select().from(dailyReportLines).where(eq(dailyReportLines.dailyReportId, report.id));
    await tx.delete(dailyReportLines).where(eq(dailyReportLines.dailyReportId, report.id));
    if (lines.length) await tx.insert(dailyReportLines).values(lines.map((l) => ({ ...l, dailyReportId: report.id })));
    const strip = (l: { agentId: string; leads: number; calls: number; meetings: number; tokens: number; bookings: number; remarks: string | null }) => ({
      agentId: l.agentId,
      leads: l.leads,
      calls: l.calls,
      meetings: l.meetings,
      tokens: l.tokens,
      bookings: l.bookings,
      remarks: l.remarks,
    });
    await audit(tx, actor, before.length ? "daily_report.update" : "daily_report.create", "daily_report", report.id, before.length ? { teamId: team.id, date, lines: before.map(strip) } : null, {
      teamId: team.id,
      date,
      lines: lines.map(strip),
    });
    return { reportId: report.id, lines: lines.length };
  });
}

/**
 * FR-122 save: one status per member per day; null clears the day. Editable for future days and
 * today until 11:00 (observed lock, T-A6). Recorded only; rotation is unchanged (T-A7).
 */
export async function saveRoster(db: Database, actor: Actor, teamId: string, rawDate: string, input: unknown, now = new Date()) {
  const date = parse(dateParam, rawDate);
  const { entries } = parse(rosterSchema, input);
  return db.transaction(async (tx) => {
    const team = await loadTeam(tx, teamId);
    if (!canOperateTeam(actor, team.id)) throw forbidden();
    if (!rosterEditable(date, now)) throw new AppError("BUSINESS_RULE", "This day's roster is locked (after 11:00, or a past day).");
    const members = (await tx.select({ userId: teamMembers.userId }).from(teamMembers).where(eq(teamMembers.teamId, team.id))).map((r) => r.userId);
    if (entries.some((e) => !members.includes(e.userId))) throw fieldError("entries", "Every entry must be for a member of this team");
    const ids = entries.map((e) => e.userId);
    const before = ids.length ? await tx.select().from(rosterEntries).where(and(inArray(rosterEntries.userId, ids), eq(rosterEntries.date, date))) : [];
    let changed = 0;
    for (const e of entries) {
      const prev = before.find((b) => b.userId === e.userId);
      if ((prev?.status ?? null) === e.status && (!prev || prev.teamId === team.id)) continue;
      changed++;
      if (e.status === null) {
        await tx.delete(rosterEntries).where(and(eq(rosterEntries.userId, e.userId), eq(rosterEntries.date, date)));
      } else {
        await tx
          .insert(rosterEntries)
          .values({ teamId: team.id, userId: e.userId, date, status: e.status, setById: actor.id })
          .onConflictDoUpdate({ target: [rosterEntries.userId, rosterEntries.date], set: { teamId: team.id, status: e.status, setById: actor.id, updatedAt: new Date() } });
      }
    }
    if (changed) {
      await audit(tx, actor, "roster.save", "roster", `${team.id}:${date}`, { entries: before.map((b) => ({ userId: b.userId, status: b.status })) }, { entries });
    }
    return { changed };
  });
}
