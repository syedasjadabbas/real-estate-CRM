import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { followUps, leads, meetings, signinLogs, teamMembers, teams, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { PERFORMANCE_PAGE_SIZE, pct, performanceQuerySchema, resolveRange, type PerformanceSort } from "./range";

/**
 * Performance (FR-150 / FR-151 / FR-002): agent KPIs computed from existing records only.
 * Scope (matrix "Performance F/F/T/O/—/—"): admins all agents; managers their teams' agents;
 * agents themselves; HR and accountants none. Call metrics and the Critical flag have no data or
 * rule in this system and are reported as unavailable (see PERFORMANCE_MODULE_PLAN.md).
 */
export function canViewPerformance(actor: Pick<Actor, "role">) {
  return ["super_admin", "admin", "manager", "agent"].includes(actor.role);
}

/** Context options for the Filters drawer: teams the actor may scope to. */
export async function performanceContexts(db: Database, actor: Actor) {
  if (!canViewPerformance(actor) || actor.role === "agent") return [];
  const where = actor.role === "manager" ? (actor.managedTeamIds.length ? inArray(teams.id, actor.managedTeamIds) : sql`false`) : undefined;
  return db.select({ id: teams.id, name: teams.name, isActive: teams.isActive }).from(teams).where(where).orderBy(asc(sql`lower(${teams.name})`));
}

/** P11: active agents in scope, optionally narrowed to one team the actor may see. */
async function agentsInScope(db: Database, actor: Actor, teamId: string | undefined) {
  if (actor.role === "agent") return db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, actor.id));
  if (actor.role === "manager" && teamId && !actor.managedTeamIds.includes(teamId)) throw forbidden("You can only see your own teams.");
  const teamIds = teamId ? [teamId] : actor.role === "manager" ? actor.managedTeamIds : null;
  if (teamIds && teamIds.length === 0) return [];
  const base = and(eq(users.role, "agent"), eq(users.status, "active"));
  if (!teamIds) return db.select({ id: users.id, name: users.name }).from(users).where(base).orderBy(asc(users.name));
  return db
    .selectDistinct({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
    .where(and(base, inArray(teamMembers.teamId, teamIds)))
    .orderBy(asc(users.name));
}

export type AgentMetrics = {
  userId: string;
  name: string;
  leads: number;
  open: number;
  booked: number;
  lost: number;
  winPct: number | null;
  fuDue: number;
  fuDone: number;
  fuPct: number | null;
  meetings: number;
  signIns: number;
  signOuts: number;
};

const n = (v: unknown) => Number(v ?? 0);

/**
 * Questionnaire Q25: leads count by their original assignment date. That is the creation date,
 * unless the lead was created without an owner; then it is the first assignment from nobody.
 * Later reassignments (which record a previous owner) never move the date.
 */
const assignedAt = sql`coalesce(
  (select min(a.created_at) from lead_activities a where a.lead_id = "leads"."id" and a.type = 'assignment' and (a.data->>'from') is null),
  "leads"."created_at")`;

/** Per-agent metrics for the window (definitions P2–P9). */
async function agentMetrics(db: Database, agents: { id: string; name: string }[], window: { start: Date; end: Date }): Promise<AgentMetrics[]> {
  const ids = agents.map((a) => a.id);
  if (ids.length === 0) return [];
  const [leadRows, fuRows, meetingRows, signRows] = await Promise.all([
    db
      .select({
        userId: leads.ownerId,
        total: sql<number>`count(*)::int`,
        booked: sql<number>`count(*) filter (where ${leads.stage} = 'booked')::int`,
        lost: sql<number>`count(*) filter (where ${leads.stage} = 'lost_lead')::int`,
      })
      .from(leads)
      .where(and(inArray(leads.ownerId, ids), isNull(leads.deletedAt), sql`${assignedAt} >= ${window.start}`, sql`${assignedAt} < ${window.end}`))
      .groupBy(leads.ownerId),
    db
      .select({
        userId: followUps.assigneeId,
        due: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${followUps.status} = 'done')::int`,
      })
      .from(followUps)
      .where(and(inArray(followUps.assigneeId, ids), sql`${followUps.status} <> 'cancelled'`, gte(followUps.dueAt, window.start), lt(followUps.dueAt, window.end)))
      .groupBy(followUps.assigneeId),
    db
      .select({ userId: meetings.organizerId, done: sql<number>`count(*)::int` })
      .from(meetings)
      .where(and(inArray(meetings.organizerId, ids), eq(meetings.status, "completed"), gte(meetings.startsAt, window.start), lt(meetings.startsAt, window.end)))
      .groupBy(meetings.organizerId),
    db
      .select({
        userId: signinLogs.userId,
        ins: sql<number>`count(*) filter (where ${signinLogs.event} = 'sign_in')::int`,
        outs: sql<number>`count(*) filter (where ${signinLogs.event} = 'sign_out')::int`,
      })
      .from(signinLogs)
      .where(and(inArray(signinLogs.userId, ids), gte(signinLogs.at, window.start), lt(signinLogs.at, window.end)))
      .groupBy(signinLogs.userId),
  ]);
  return agents.map((a) => {
    const l = leadRows.find((r) => r.userId === a.id);
    const f = fuRows.find((r) => r.userId === a.id);
    const s = signRows.find((r) => r.userId === a.id);
    const total = n(l?.total);
    const booked = n(l?.booked);
    const lost = n(l?.lost);
    const fuDue = n(f?.due);
    const fuDone = n(f?.done);
    return {
      userId: a.id,
      name: a.name,
      leads: total,
      open: total - booked - lost,
      booked,
      lost,
      winPct: pct(booked, booked + lost),
      fuDue,
      fuDone,
      fuPct: pct(fuDone, fuDue),
      meetings: n(meetingRows.find((r) => r.userId === a.id)?.done),
      signIns: n(s?.ins),
      signOuts: n(s?.outs),
    };
  });
}

function sortRows(rows: AgentMetrics[], sort: PerformanceSort, dir: "asc" | "desc") {
  const key = sort === "agent" ? "name" : sort;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key as keyof AgentMetrics];
    const y = b[key as keyof AgentMetrics];
    // Missing percentages (no decided leads / no follow-ups due) sort last either way.
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    const c = typeof x === "string" ? x.localeCompare(String(y)) : Number(x) - Number(y);
    return c !== 0 ? c * sign : a.name.localeCompare(b.name);
  });
}

/** The Performance page / API payload: summary, charts, the sorted and paginated table. */
export async function performanceReport(db: Database, actor: Actor, rawQuery: unknown, now = new Date()) {
  if (!canViewPerformance(actor)) throw forbidden();
  const q = performanceQuerySchema.parse(rawQuery ?? {});
  const range = resolveRange(q.from, q.to, now);
  const team = actor.role === "agent" ? undefined : q.team;
  const agents = await agentsInScope(db, actor, team);
  const all = await agentMetrics(db, agents, range.window);

  const sum = (k: keyof AgentMetrics) => all.reduce((acc, r) => acc + Number(r[k] ?? 0), 0);
  const count = all.length;
  const totals = {
    agents: count,
    leads: sum("leads"),
    open: sum("open"),
    booked: sum("booked"),
    lost: sum("lost"),
    fuDue: sum("fuDue"),
    fuDone: sum("fuDone"),
    meetings: sum("meetings"),
    signIns: sum("signIns"),
    signOuts: sum("signOuts"),
  };
  const per = (v: number) => (count ? Math.round((v / count) * 10) / 10 : 0);
  const sorted = sortRows(all, q.sort, q.dir);
  const pageCount = Math.max(1, Math.ceil(count / PERFORMANCE_PAGE_SIZE));
  const page = Math.min(q.page, pageCount);
  return {
    range: { from: range.from, to: range.to },
    team: team ?? null,
    context: actor.role === "agent" ? ("own" as const) : team ? ("team" as const) : actor.role === "manager" ? ("my_teams" as const) : ("all" as const),
    summary: {
      ...totals,
      winPct: pct(totals.booked, totals.booked + totals.lost),
      fuPct: pct(totals.fuDone, totals.fuDue),
      perAgent: { open: per(totals.open), meetings: per(totals.meetings), signIns: per(totals.signIns) },
    },
    charts: {
      outcomeMix: { open: totals.open, booked: totals.booked, lost: totals.lost, total: totals.open + totals.booked + totals.lost },
      topClosers: [...all]
        .filter((r) => r.booked > 0)
        .sort((a, b) => b.booked - a.booked || (b.winPct ?? 0) - (a.winPct ?? 0) || a.name.localeCompare(b.name))
        .slice(0, 5)
        .map((r) => ({ userId: r.userId, name: r.name, booked: r.booked, winPct: r.winPct })),
    },
    sort: q.sort,
    dir: q.dir,
    page,
    pageCount,
    total: count,
    rows: sorted.slice((page - 1) * PERFORMANCE_PAGE_SIZE, page * PERFORMANCE_PAGE_SIZE),
    allRows: sorted,
    generatedAt: now.toISOString(),
  };
}
export type PerformanceReport = Awaited<ReturnType<typeof performanceReport>>;

/** Observed "Export CSV": every agent row in scope for the range (call columns blank: no call data). */
export function performanceCsv(report: PerformanceReport) {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Agent", "From", "To", "Open leads", "Booked", "Lost", "Win %", "Calls", "Call min", "F/U due", "F/U done", "F/U %", "Meetings", "CRM sign-ins", "CRM sign-outs"];
  const lines = report.allRows.map((r) =>
    [r.name, report.range.from, report.range.to, r.open, r.booked, r.lost, r.winPct, "", "", r.fuDue, r.fuDone, r.fuPct, r.meetings, r.signIns, r.signOuts].map(esc).join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}
