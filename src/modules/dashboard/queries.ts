import { and, asc, count, desc, eq, gte, inArray, isNull, lt, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db";
import { leadSources, leads, lostReasons, meetings, projects, teamMembers, teams, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { INBOUND_LABELS, STAGE_LABELS } from "@/modules/leads/constants";
import { leadScope } from "@/modules/leads/policy";
import { scopeFilter, teamMemberIds } from "@/modules/leads/support";
import type { DashboardData, LostBreakdown, LostTeam, RangeKey } from "@/features/dashboard/types";

/**
 * Dashboard analytics (FR-010 to FR-013, FR-015) for the active project and the actor's lead scope
 * (agents: own, managers: their teams, admins: all; HR and accountants see no lead analytics).
 * Formulas are listed in docs/DASHBOARD_PLAN.md; the client has not confirmed the metric definitions.
 */

export const RANGE_KEYS = ["24h", "7d", "30d", "mtd", "6m", "custom"] as const satisfies readonly RangeKey[];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET = "+05:00"; // Asia/Karachi, no daylight saving

export const dashboardQuerySchema = z.object({
  range: z.enum(RANGE_KEYS).catch("mtd"),
  from: z.string().regex(DATE).optional().catch(undefined),
  to: z.string().regex(DATE).optional().catch(undefined),
  team: z.string().uuid().optional().catch(undefined),
});
export type DashboardQuery = z.output<typeof dashboardQuerySchema>;

export const STALE_DAYS = 14;
export const MEETING_WINDOW_DAYS = 30;
const DAY = 86_400_000;

/** [start, end) of the selected range. Custom without both dates falls back to month to date. */
export function rangeBounds(query: DashboardQuery, now = new Date()): { start: Date; end: Date; range: RangeKey } {
  const karachi = new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
  const monthStart = new Date(`${karachi.slice(0, 7)}-01T00:00:00${OFFSET}`);
  switch (query.range) {
    case "24h":
      return { start: new Date(now.getTime() - DAY), end: now, range: "24h" };
    case "7d":
      return { start: new Date(now.getTime() - 7 * DAY), end: now, range: "7d" };
    case "30d":
      return { start: new Date(now.getTime() - 30 * DAY), end: now, range: "30d" };
    case "6m": {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 6);
      return { start, end: now, range: "6m" };
    }
    case "custom":
      if (query.from && query.to && query.from <= query.to) {
        const end = new Date(new Date(`${query.to}T00:00:00${OFFSET}`).getTime() + DAY);
        return { start: new Date(`${query.from}T00:00:00${OFFSET}`), end, range: "custom" };
      }
      return { start: monthStart, end: now, range: "mtd" };
    default:
      return { start: monthStart, end: now, range: "mtd" };
  }
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Teams the actor may filter by: managers their own teams, admins all active teams, others none. */
async function teamOptions(db: Database, actor: Actor) {
  const scope = leadScope(actor.role);
  if (scope === "all") return db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.isActive, true)).orderBy(asc(teams.name));
  if (scope === "team" && actor.managedTeamIds.length > 0) {
    return db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, actor.managedTeamIds)).orderBy(asc(teams.name));
  }
  return [];
}

const businessDay = (d: Date) => new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);

/** Groups the lost-lead rows; the dates let the widget link to the Lost list for the same days. */
export function lostBreakdown(
  reasons: { id: string | null; label: string | null; count: number }[],
  teamRows: { teamId: string | null; teamName: string | null; ownerId: string | null; ownerName: string | null; count: number }[],
  start: Date,
  end: Date,
): LostBreakdown {
  const byTeam = new Map<string, LostTeam>();
  for (const r of teamRows) {
    const key = r.teamId ?? "none";
    const team = byTeam.get(key) ?? { id: key, label: r.teamName ?? "No team", count: 0, agents: [] };
    team.count += r.count;
    team.agents.push({ id: r.ownerId ?? "unassigned", label: r.ownerName ?? "Unassigned", count: r.count });
    byTeam.set(key, team);
  }
  const teamsSorted = [...byTeam.values()]
    .map((t) => ({ ...t, agents: t.agents.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)) }))
    .sort((a, b) => (a.id === "none" ? 1 : b.id === "none" ? -1 : b.count - a.count || a.label.localeCompare(b.label)));
  return {
    byReason: reasons.map((r) => ({ id: r.id ?? "none", label: r.label ?? "No reason recorded", count: r.count })),
    byTeam: teamsSorted,
    total: reasons.reduce((n, r) => n + r.count, 0),
    from: businessDay(start),
    to: businessDay(new Date(end.getTime() - 1)),
  };
}

export async function dashboardData(db: Database, actor: Actor, projectId: string | null, input: unknown = {}, now = new Date()) {
  const query = dashboardQuerySchema.parse(input ?? {});
  const { start, end, range } = rangeBounds(query, now);
  const scope = leadScope(actor.role);
  const base = {
    query: { ...query, range },
    window: { start: start.toISOString(), end: end.toISOString() },
  };
  if (scope === "none" || !projectId) return { ...base, data: null, allowed: scope !== "none" };

  const members = await teamMemberIds(db, actor);
  const options = await teamOptions(db, actor);
  const team = query.team && options.some((t) => t.id === query.team) ? query.team : undefined;
  const teamOwners = team ? (await db.select({ id: teamMembers.userId }).from(teamMembers).where(eq(teamMembers.teamId, team))).map((r) => r.id) : null;
  const teamFilter: SQL | undefined = teamOwners ? (teamOwners.length ? inArray(leads.ownerId, teamOwners) : sql`false`) : undefined;

  const inScope = and(scopeFilter(actor, members), isNull(leads.deletedAt), teamFilter);
  const inProject = and(inScope, eq(leads.projectId, projectId));
  const inRange = and(inProject, gte(leads.createdAt, start), lt(leads.createdAt, end));
  const open = notInArray(leads.stage, ["booked", "lost_lead"]);

  const lostInRange = and(inRange, eq(leads.stage, "lost_lead"));
  const [[k], sources, channels, recent, top, [activeProjects], [health], [meetingsDone], lostReasonRows, lostTeamRows] = await Promise.all([
    db
      .select({
        total: count(),
        won: sql<number>`count(*) filter (where ${leads.stage} = 'booked')::int`,
        lost: sql<number>`count(*) filter (where ${leads.stage} = 'lost_lead')::int`,
        regenerated: sql<number>`count(*) filter (where ${leads.isRegenerated})::int`,
        awaiting: sql<number>`count(*) filter (where ${leads.firstTouchAt} is null and ${leads.stage} not in ('booked', 'lost_lead'))::int`,
      })
      .from(leads)
      .where(inRange),
    db
      .select({ id: leadSources.id, label: leadSources.name, count: count() })
      .from(leads)
      .innerJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .where(inRange)
      .groupBy(leadSources.id, leadSources.name)
      .orderBy(desc(count()), asc(leadSources.name)),
    db.select({ channel: leads.inboundChannel, count: count() }).from(leads).where(inRange).groupBy(leads.inboundChannel).orderBy(desc(count())),
    db
      .select({ id: leads.id, name: leads.name, stage: leads.stage, inbound: leads.inboundChannel, owner: users.name, createdAt: leads.createdAt })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .where(inProject)
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(20),
    db
      .select({ id: projects.id, label: projects.name, count: count() })
      .from(leads)
      .innerJoin(projects, eq(projects.id, leads.projectId))
      .where(and(inScope, gte(leads.createdAt, start), lt(leads.createdAt, end)))
      .groupBy(projects.id, projects.name)
      .orderBy(desc(count()), asc(projects.name))
      .limit(5),
    db.select({ n: count() }).from(projects).where(eq(projects.status, "active")),
    db
      .select({
        stale: sql<number>`count(*) filter (where ${leads.updatedAt} < ${new Date(now.getTime() - STALE_DAYS * DAY)})::int`,
        noMeeting: sql<number>`count(*) filter (where not exists (
          select 1 from ${meetings} m where m.lead_id = "leads"."id" and m.status <> 'cancelled'
            and m.starts_at >= ${new Date(now.getTime() - MEETING_WINDOW_DAYS * DAY)} and m.starts_at < ${now}
        ))::int`,
      })
      .from(leads)
      .where(and(inProject, open)),
    db
      .select({ n: count() })
      .from(meetings)
      .innerJoin(leads, eq(leads.id, meetings.leadId))
      .where(
        and(
          inProject,
          eq(meetings.status, "completed"),
          gte(meetings.startsAt, new Date(now.getTime() - MEETING_WINDOW_DAYS * DAY)),
          lt(meetings.startsAt, now),
        ),
      ),
    db
      .select({ id: lostReasons.id, label: lostReasons.name, count: count() })
      .from(leads)
      .leftJoin(lostReasons, eq(lostReasons.id, leads.lostReasonId))
      .where(lostInRange)
      .groupBy(lostReasons.id, lostReasons.name)
      .orderBy(desc(count()), asc(lostReasons.name)),
    // A lead counts under every active team its owner belongs to; owners in no team appear under "No team".
    db
      .select({ teamId: teams.id, teamName: teams.name, ownerId: users.id, ownerName: users.name, count: count() })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .leftJoin(teamMembers, eq(teamMembers.userId, leads.ownerId))
      .leftJoin(teams, and(eq(teams.id, teamMembers.teamId), eq(teams.isActive, true)))
      .where(lostInRange)
      .groupBy(teams.id, teams.name, users.id, users.name),
  ]);

  const total = k.total;
  const openCount = total - k.won - k.lost;
  const data: DashboardData = {
    isSample: false,
    snapshotAt: now.toISOString(),
    kpis: {
      totalLeads: total,
      openPct: pct(openCount, total),
      wonPct: pct(k.won, total),
      lostPct: pct(k.lost, total),
      conversionRate: pct(k.won, total),
      winOnDecided: pct(k.won, k.won + k.lost),
      openPipeline: openCount,
      openPipelinePct: pct(openCount, total),
      won: k.won,
      lost: k.lost,
      attritionPct: pct(k.lost, k.won + k.lost),
      regenerated: k.regenerated,
      awaitingFirstTouch: k.awaiting,
    },
    teams: options,
    activeProjects: activeProjects.n,
    topProjects: top,
    insights: null,
    insightsUpdatedAt: null,
    teamScores: [],
    teamOutput: [],
    meetingMix: [],
    targets: null,
    pipelineHealth: { stale: health.stale, noMeeting: health.noMeeting, meetingsDone: meetingsDone.n, rows: [] },
    leadSources: sources,
    inboundChannels: channels.map((c) => ({ id: c.channel, label: INBOUND_LABELS[c.channel], count: c.count })),
    lost: lostBreakdown(lostReasonRows, lostTeamRows, start, end),
    recentLeads: recent.map((r) => ({
      id: r.id,
      name: r.name,
      status: STAGE_LABELS[r.stage],
      inbound: INBOUND_LABELS[r.inbound],
      owner: r.owner ?? "Unassigned",
      createdAt: r.createdAt.toISOString(),
    })),
  };
  return { ...base, query: { ...query, range, team }, data, allowed: true };
}
