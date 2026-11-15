import { and, asc, desc, eq, ilike, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { dailySheet } from "@/modules/attendance/service";
import { businessToday } from "@/modules/bookings/today";
import { LEAD_STAGES, type LeadStage } from "@/modules/leads/constants";
import { pageWithin } from "@/modules/leads/support";
import { agentMetrics } from "@/modules/performance/service";
import { resolveRange } from "@/modules/performance/range";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { attendanceRecords, followUps, leads, rosterEntries, teamMembers, teams, users } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/errors";
import type { RosterStatus } from "./validation";

/**
 * "My team" for a Team Lead (owner, 15 Nov 2026): a read-only view of the team they lead. They see
 * each member's pipeline, follow-ups, calls, meetings and today's roster and attendance, and the
 * team's open leads. Nothing here changes data, and the team's leads are listed, not opened: lead
 * pages, approvals and reassignment stay with the agents who own them and with Admins.
 */
export const isTeamLeadOf = (actor: Pick<Actor, "role" | "ledTeamIds">, teamId: string) => actor.role === "agent" && Boolean(actor.ledTeamIds?.includes(teamId));

const OPEN_LEAD_PAGE = 50;

/** Filters on the team's open leads (owner review, 16 Nov 2026): search, agent, stage, overdue only, page. */
const leadFilterSchema = z.object({
  lq: z.string().trim().max(100).optional().catch(undefined),
  lagent: z.uuid().optional().catch(undefined),
  lstage: z.enum(LEAD_STAGES).optional().catch(undefined),
  ldue: z.literal("overdue").optional().catch(undefined),
  lpage: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export async function myTeamView(db: Database, actor: Actor, rawTeamId: string | undefined, rawQuery: { from?: string; to?: string; lq?: string; lagent?: string; lstage?: string; ldue?: string; lpage?: string } = {}, now = new Date()) {
  const led = actor.ledTeamIds ?? [];
  if (actor.role !== "agent" || led.length === 0) throw forbidden("Only Team Leads have a team view.");
  const teamList = await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, led)).orderBy(asc(teams.name));
  const team = teamList.find((t) => t.id === rawTeamId) ?? teamList[0];
  if (!team) throw notFound("Team");

  const members = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, team.id), eq(users.status, "active"), eq(users.role, "agent")))
    .orderBy(asc(users.name));
  const ids = members.map((m) => m.id);
  const range = resolveRange(rawQuery.from, rawQuery.to, now);
  const today = businessToday(now);

  const metrics = await agentMetrics(db, members, range.window);
  const stageRows = ids.length
    ? await db
        .select({ ownerId: leads.ownerId, stage: leads.stage, n: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(inArray(leads.ownerId, ids), isNull(leads.deletedAt)))
        .groupBy(leads.ownerId, leads.stage)
    : [];
  const overdueRows = ids.length
    ? await db
        .select({ userId: followUps.assigneeId, n: sql<number>`count(*)::int` })
        .from(followUps)
        .where(and(inArray(followUps.assigneeId, ids), eq(followUps.status, "pending"), sql`${followUps.dueAt} < ${now}`))
        .groupBy(followUps.assigneeId)
    : [];
  const roster = ids.length
    ? await db.select({ userId: rosterEntries.userId, status: rosterEntries.status }).from(rosterEntries).where(and(inArray(rosterEntries.userId, ids), eq(rosterEntries.date, today)))
    : [];
  const attendance = ids.length
    ? await db.select({ userId: attendanceRecords.userId, checkInAt: attendanceRecords.checkInAt, checkOutAt: attendanceRecords.checkOutAt }).from(attendanceRecords).where(and(inArray(attendanceRecords.userId, ids), eq(attendanceRecords.date, today)))
    : [];
  // Reuse the attendance rules for each member's status today (present / late / on leave / …).
  const sheet = await dailySheet(db, { ...actor, role: "hr" } as Actor, today, today);

  const lf = leadFilterSchema.parse(rawQuery);
  const term = lf.lq ? `%${lf.lq.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const openWhere = and(inArray(leads.ownerId, ids), isNull(leads.deletedAt), notInArray(leads.stage, ["booked", "lost_lead"]));
  const leadWhere = and(
    openWhere,
    lf.lagent && ids.includes(lf.lagent) ? eq(leads.ownerId, lf.lagent) : undefined,
    lf.lstage ? eq(leads.stage, lf.lstage) : undefined,
    lf.ldue ? lt(leads.nextFollowUpAt, now) : undefined,
    term ? or(ilike(leads.name, term), ilike(leads.code, term)) : undefined,
  );
  const [openTotal] = ids.length ? await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(openWhere) : [{ n: 0 }];
  const [matchTotal] = ids.length ? await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(leadWhere) : [{ n: 0 }];
  const leadPage = pageWithin(lf.lpage, matchTotal.n, OPEN_LEAD_PAGE);
  const openLeads = ids.length
    ? await db
        .select({ id: leads.id, code: leads.code, name: leads.name, stage: leads.stage, ownerId: leads.ownerId, nextFollowUpAt: leads.nextFollowUpAt, lastActivityAt: leads.lastActivityAt })
        .from(leads)
        .where(leadWhere)
        .orderBy(sql`${leads.nextFollowUpAt} asc nulls last`, desc(leads.lastActivityAt), asc(leads.id))
        .limit(OPEN_LEAD_PAGE)
        .offset((leadPage.page - 1) * OPEN_LEAD_PAGE)
    : [];

  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  return {
    teams: teamList,
    team,
    range: { from: range.from, to: range.to },
    today,
    members: members.map((m) => {
      const pipeline = Object.fromEntries(LEAD_STAGES.map((s) => [s, stageRows.find((r) => r.ownerId === m.id && r.stage === s)?.n ?? 0])) as Record<LeadStage, number>;
      const att = attendance.find((a) => a.userId === m.id);
      return {
        id: m.id,
        name: m.name,
        isMe: m.id === actor.id,
        metrics: metrics.find((x) => x.userId === m.id)!,
        pipeline,
        open: LEAD_STAGES.filter((s) => s !== "booked" && s !== "lost_lead").reduce((n, s) => n + pipeline[s], 0),
        overdue: overdueRows.find((r) => r.userId === m.id)?.n ?? 0,
        roster: (roster.find((r) => r.userId === m.id)?.status ?? null) as RosterStatus | null,
        attendance: sheet.rows.find((r) => r.userId === m.id)?.status ?? "not_yet",
        checkIn: att ? att.checkInAt : null,
      };
    }),
    openLeads: openLeads.map((l) => ({ ...l, ownerName: (l.ownerId && nameOf.get(l.ownerId)) || "—", mine: l.ownerId === actor.id })),
    openTotal: openTotal.n,
    leadFilters: { q: lf.lq ?? "", agent: lf.lagent ?? "", stage: lf.lstage ?? "", due: lf.ldue ?? "" },
    leadMatches: matchTotal.n,
    leadPage,
  };
}

export type MyTeamView = Awaited<ReturnType<typeof myTeamView>>;
