import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, bookings, meetings, targets, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { businessToday } from "@/modules/bookings/today";
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
 * calls = not available: uploaded recordings don't count as calls unless confirmed (C-19, T-A12).
 */
export async function listTargets(db: Database, actor: Actor, rawQuery: unknown, now = new Date()) {
  if (!canViewTargets(actor)) throw forbidden();
  const q = targetQuerySchema.parse(rawQuery ?? {});
  const anchor = q.anchor ?? `${businessToday(now).slice(0, 7)}-01`;
  const start = periodStart(q.period, anchor);
  const window = periodWindow(q.period, start);
  const agents = await scopedAgents(db, actor);
  const ids = agents.map((a) => a.id);
  const [targetRows, meetingRows, sqftRows] = ids.length
    ? await Promise.all([
        db.select().from(targets).where(and(inArray(targets.userId, ids), eq(targets.period, q.period), eq(targets.periodStart, start))),
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
      ])
    : [[], [], []];
  const members = targetScope(actor.role) === "team" ? await teamMemberIds(db, actor) : [];
  const rows = agents.map((a) => {
    const t = targetRows.find((r) => r.userId === a.id) ?? null;
    const meetingsDone = meetingRows.find((r) => r.userId === a.id)?.n ?? 0;
    const sqft = Number(sqftRows.find((r) => r.userId === a.id)?.sqft ?? 0);
    return {
      userId: a.id,
      name: a.name,
      target: t ? { calls: t.calls, meetings: t.meetings, soldSqft: t.soldSqft } : null,
      achieved: { calls: null as number | null, meetings: meetingsDone, soldSqft: sqft },
      percent: t ? { calls: percent(null, t.calls), meetings: percent(meetingsDone, t.meetings), soldSqft: percent(sqft, t.soldSqft) } : null,
      canEdit: canSetTargets(actor) && canSetTargetFor(actor, a.id, members),
    };
  });
  return { period: q.period as TargetPeriod, anchor, periodStart: start, rows, canSet: canSetTargets(actor) };
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
    [r.name, grid.period, grid.periodStart, r.target?.calls ?? 0, "", r.target?.meetings ?? 0, r.achieved.meetings, r.target?.soldSqft ?? 0, r.achieved.soldSqft].map(esc).join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}
