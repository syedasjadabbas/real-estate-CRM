import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, bookings, meetings, targets, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { businessToday } from "@/modules/bookings/today";
import { callStatsByUser } from "@/modules/performance/calls";
import { teamMemberIds } from "@/modules/leads/support";
import { parseTask as parse, taskFieldError as fieldError } from "@/modules/tasks/support";
import { percent, periodStart, periodWindow, type TargetPeriod } from "./period";
import { canSetTargetFor, canSetTargets, canViewTargets, targetScope } from "./policy";
import { setTargetSchema, targetQuerySchema } from "./validation";

/** Agents whose targets the actor may see: all active agents, their teams' agents, or themselves. */
async function scopedAgents(db: Database, actor: Actor) {
  const scope = targetScope(actor.role);
  if (scope === "own") return db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, actor.id));
  const members = scope === "team" ? await teamMemberIds(db, actor) : [];
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.role, "agent"), eq(users.status, "active"), scope === "team" ? (members.length ? inArray(users.id, members) : sql`false`) : undefined))
    .orderBy(asc(users.name));
}

/**
 * FR-110 / FR-111 grid: each agent's target for the period and the achievement so far.
 * Meetings achieved = completed meetings they organized that started in the window (T-A10);
 * sold sq ft = area of their bookings confirmed in the window (Q-H4 default, T-A11);
 * calls = call recordings they uploaded in the window (client confirmation 10 Nov 2026, T-A12): a `files` row with
 * kind 'call_recording', a lead and no deleted_at, attributed to `uploaded_by_id`, counted by `created_at`.
 * Every recording counts, whatever its duration (definition in performance/calls.ts).
 */
export type Achieved = { calls: number; meetings: number; soldSqft: number };
const NOTHING: Achieved = { calls: 0, meetings: 0, soldSqft: 0 };
export const TARGET_METRICS = [
  { key: "calls", label: "Calls" },
  { key: "meetings", label: "Meetings" },
  { key: "soldSqft", label: "Sold (sq ft)" },
] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number]["key"];

/** Each agent's achievement in a window: calls (uploaded recordings), completed meetings, confirmed sq ft. */
export async function achievementsFor(db: Database, ids: string[], window: { from: Date; to: Date }) {
  const out = new Map<string, Achieved>();
  if (ids.length === 0) return out;
  const [meetingRows, sqftRows, callStats] = await Promise.all([
    db
      .select({ userId: meetings.organizerId, n: sql<number>`count(*)::int` })
      .from(meetings)
      .where(and(inArray(meetings.organizerId, ids), eq(meetings.status, "completed"), gte(meetings.startsAt, window.from), lt(meetings.startsAt, window.to)))
      .groupBy(meetings.organizerId),
    db
      .select({ userId: bookings.agentId, sqft: sql<string>`coalesce(sum(${bookings.areaSqft}), 0)` })
      .from(bookings)
      .where(and(inArray(bookings.agentId, ids), eq(bookings.stage, "confirmed"), gte(bookings.confirmedAt, window.from), lt(bookings.confirmedAt, window.to)))
      .groupBy(bookings.agentId),
    callStatsByUser(db, ids, { start: window.from, end: window.to }),
  ]);
  for (const id of ids) {
    out.set(id, {
      calls: callStats.get(id)?.calls ?? 0,
      meetings: meetingRows.find((r) => r.userId === id)?.n ?? 0,
      soldSqft: Number(sqftRows.find((r) => r.userId === id)?.sqft ?? 0),
    });
  }
  return out;
}

/** The goals of a target that are reached in full (a goal of 0 is not set, so never "met"). */
export function metGoals(goals: Achieved, achieved: Achieved): TargetMetric[] {
  return TARGET_METRICS.filter((m) => goals[m.key] > 0 && achieved[m.key] >= goals[m.key]).map((m) => m.key);
}

/** One agent's targets for today, this week and this month, with achievement so far. */
export async function currentTargets(db: Database, userId: string, now = new Date()) {
  const today = businessToday(now);
  const rows = await db.select().from(targets).where(eq(targets.userId, userId));
  return Promise.all(
    (["daily", "weekly", "monthly"] as const).map(async (period) => {
      const start = periodStart(period, today);
      const t = rows.find((r) => r.period === period && r.periodStart === start) ?? null;
      const got = (await achievementsFor(db, [userId], periodWindow(period, start))).get(userId) ?? NOTHING;
      const goals = t ? { calls: t.calls, meetings: t.meetings, soldSqft: t.soldSqft } : null;
      return { period, start, goals, achieved: got, met: goals ? metGoals(goals, got) : [] };
    }),
  );
}

/**
 * Targets met per agent (Performance, owner 14 Nov 2026): over the targets whose period starts in the
 * date range, how many goals were set and how many were reached in their own period.
 */
export async function targetsMetFor(db: Database, ids: string[], fromDate: string, toDate: string) {
  const out = new Map<string, { met: number; set: number }>();
  if (ids.length === 0) return out;
  const rows = await db
    .select()
    .from(targets)
    .where(and(inArray(targets.userId, ids), gte(targets.periodStart, fromDate), sql`${targets.periodStart} <= ${toDate}`));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.period}|${r.periodStart}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const group of groups.values()) {
    const { period, periodStart: start } = group[0];
    const got = await achievementsFor(db, group.map((r) => r.userId), periodWindow(period as TargetPeriod, start));
    for (const r of group) {
      const goals = { calls: r.calls, meetings: r.meetings, soldSqft: r.soldSqft };
      const acc = out.get(r.userId) ?? { met: 0, set: 0 };
      acc.set += TARGET_METRICS.filter((m) => goals[m.key] > 0).length;
      acc.met += metGoals(goals, got.get(r.userId) ?? NOTHING).length;
      out.set(r.userId, acc);
    }
  }
  return out;
}

/** Agents per page on the Targets screen (FR-005). The CSV export always takes every agent. */
export const TARGETS_PAGE_SIZE = 50;

export async function listTargets(db: Database, actor: Actor, rawQuery: unknown, now = new Date(), opts: { all?: boolean } = {}) {
  if (!canViewTargets(actor)) throw forbidden();
  const q = targetQuerySchema.parse(rawQuery ?? {});
  const anchor = q.anchor ?? `${businessToday(now).slice(0, 7)}-01`;
  const start = periodStart(q.period, anchor);
  const window = periodWindow(q.period, start);
  const everyone = await scopedAgents(db, actor);
  const total = everyone.length;
  const pageCount = Math.max(1, Math.ceil(total / TARGETS_PAGE_SIZE));
  const rawPage = Number((rawQuery as { page?: unknown } | null)?.page);
  const page = opts.all ? 1 : Math.min(Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1, pageCount);
  const agents = opts.all ? everyone : everyone.slice((page - 1) * TARGETS_PAGE_SIZE, page * TARGETS_PAGE_SIZE);
  const ids = agents.map((a) => a.id);
  const [targetRows, achieved] = ids.length
    ? await Promise.all([
        db.select().from(targets).where(and(inArray(targets.userId, ids), eq(targets.period, q.period), eq(targets.periodStart, start))),
        achievementsFor(db, ids, window),
      ])
    : [[], new Map<string, Achieved>()];
  const members = targetScope(actor.role) === "team" ? await teamMemberIds(db, actor) : [];
  const rows = agents.map((a) => {
    const t = targetRows.find((r) => r.userId === a.id) ?? null;
    const got = achieved.get(a.id) ?? NOTHING;
    const goals = t ? { calls: t.calls, meetings: t.meetings, soldSqft: t.soldSqft } : null;
    return {
      userId: a.id,
      name: a.name,
      target: goals,
      achieved: got,
      percent: goals ? { calls: percent(got.calls, goals.calls), meetings: percent(got.meetings, goals.meetings), soldSqft: percent(got.soldSqft, goals.soldSqft) } : null,
      /** Goals reached in full (owner, 14 Nov 2026): shown with a Met badge. */
      met: goals ? metGoals(goals, got) : [],
      canEdit: canSetTargets(actor) && canSetTargetFor(actor, a.id, members),
    };
  });
  return { period: q.period as TargetPeriod, anchor, periodStart: start, rows, canSet: canSetTargets(actor), page, pageCount, total };
}
export type TargetGrid = Awaited<ReturnType<typeof listTargets>>;

/** FR-110 set (upsert). All three values zero clears the target (T-A8). */
export async function setTarget(db: Database, actor: Actor, input: unknown) {
  if (!canSetTargets(actor)) throw forbidden();
  const data = parse(setTargetSchema, input);
  return db.transaction(async (tx) => {
    const [agent] = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, data.userId)).limit(1);
    if (!agent || agent.role !== "agent" || agent.status !== "active") throw fieldError("userId", "Targets are set for active agents");
    const members = targetScope(actor.role) === "team" ? await teamMemberIds(tx, actor) : [];
    if (!canSetTargetFor(actor, data.userId, members)) throw forbidden("You can set targets for your team's agents only.");
    const start = periodStart(data.period, data.anchor);
    const [current] = await tx.select().from(targets).where(and(eq(targets.userId, data.userId), eq(targets.period, data.period), eq(targets.periodStart, start)));
    const values = { calls: data.calls, meetings: data.meetings, soldSqft: data.soldSqft };
    const before = current ? { calls: current.calls, meetings: current.meetings, soldSqft: current.soldSqft } : null;
    const clear = values.calls === 0 && values.meetings === 0 && values.soldSqft === 0;
    if (clear) {
      if (!current) return { periodStart: start, changed: false, cleared: false };
      await tx.delete(targets).where(eq(targets.id, current.id));
    } else {
      if (before && JSON.stringify(before) === JSON.stringify(values)) return { periodStart: start, changed: false, cleared: false };
      await tx
        .insert(targets)
        .values({ userId: data.userId, period: data.period, periodStart: start, ...values, setById: actor.id })
        .onConflictDoUpdate({ target: [targets.userId, targets.period, targets.periodStart], set: { ...values, setById: actor.id, updatedAt: new Date() } });
    }
    await tx.insert(auditLogs).values({
      actorId: actor.id,
      ip: actor.ip ?? null,
      action: clear ? "target.clear" : before ? "target.update" : "target.create",
      entity: "target",
      entityId: `${data.userId}:${data.period}:${start}`,
      before,
      after: clear ? null : values,
    });
    return { periodStart: start, changed: true, cleared: clear };
  });
}

/** Observed "Export CSV": the visible grid for the period (T-A13). */
export function targetsCsv(grid: TargetGrid) {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Agent", "Period", "Period start", "Calls target", "Calls achieved", "Meetings target", "Meetings achieved", "Sold sqft target", "Sold sqft achieved"];
  const lines = grid.rows.map((r) =>
    [r.name, grid.period, grid.periodStart, r.target?.calls ?? 0, r.achieved.calls, r.target?.meetings ?? 0, r.achieved.meetings, r.target?.soldSqft ?? 0, r.achieved.soldSqft].map(esc).join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}
