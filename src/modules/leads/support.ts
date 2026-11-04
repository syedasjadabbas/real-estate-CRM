import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, bookings, followUps, leadActivities, leads, teamMembers } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden, notFound } from "@/server/errors";
import { canAccessLead, leadScope } from "./policy";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

/** Users in the teams the actor manages (empty for non-managers). */
export async function teamMemberIds(db: DbOrTx, actor: Actor): Promise<string[]> {
  if (leadScope(actor.role) !== "team" || actor.managedTeamIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(inArray(teamMembers.teamId, actor.managedTeamIds));
  return rows.map((r) => r.userId);
}

/** SQL filter restricting leads to the actor's scope. */
export function scopeFilter(actor: Actor, memberIds: string[]): SQL {
  switch (leadScope(actor.role)) {
    case "all":
      return sql`true`;
    case "team":
      return inArray(leads.ownerId, [actor.id, ...memberIds]);
    case "own":
      return eq(leads.ownerId, actor.id);
    default:
      throw forbidden();
  }
}

/** Loads a non-deleted lead the actor may access; 404 otherwise (no existence leak). */
export async function loadAccessibleLead(db: DbOrTx, actor: Actor, leadId: string, forUpdate = false) {
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw notFound("Lead");
  const query = db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), isNull(leads.deletedAt)))
    .limit(1);
  const [lead] = forUpdate ? await query.for("update") : await query;
  if (!lead) throw notFound("Lead");
  const members = await teamMemberIds(db, actor);
  if (!canAccessLead(actor, lead.ownerId, members)) throw notFound("Lead");
  return { lead, members };
}

export async function logActivity(
  db: DbOrTx,
  values: { leadId: string; actorId: string | null; type: typeof leadActivities.$inferInsert.type; body?: string | null; data?: Record<string, unknown> },
) {
  await db.insert(leadActivities).values({
    leadId: values.leadId,
    actorId: values.actorId,
    type: values.type,
    body: values.body ?? null,
    data: values.data ?? null,
  });
}

export async function audit(
  db: DbOrTx,
  actor: Actor,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  await db.insert(auditLogs).values({
    actorId: actor.id,
    ip: actor.ip ?? null,
    action,
    entity: "lead",
    entityId,
    before: before ?? null,
    after: after ?? null,
  });
}

/**
 * Whether the lead has an open booking (any stage except Confirmed and Cancelled). While it does, the
 * lead's stage follows the booking (FR-080 / FR-082): it stays in Booking in Process until the booking
 * is confirmed (→ Booked) or cancelled. Call it after locking the lead row, so a booking created
 * concurrently is either visible here or re-checks the lead itself (bookings/commands.ts setLeadStage).
 * The database enforces the same rule (trigger `leads_stage_follows_open_booking`, migration 0022).
 */
export async function hasOpenBooking(db: DbOrTx, leadId: string) {
  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.leadId, leadId), sql`${bookings.stage} not in ('confirmed', 'cancelled')`))
    .limit(1);
  return Boolean(row);
}


/**
 * F-2: pending follow-ups count as active work only while their lead is not Lost. Used by every reader
 * of pending follow-ups (To-dos, reminders, the follow-up filter) so the rule lives in one place. The
 * follow-ups themselves are never changed: moving a lost lead back to another stage brings them back.
 */
export const FOLLOW_UP_INACTIVE_STAGE = "lost_lead";
export const followUpLeadActive = (): SQL => sql`${leads.stage} <> ${FOLLOW_UP_INACTIVE_STAGE}`;

/** Marks a human interaction: first touch (once) and last activity. */
export function touchValues(lead: { firstTouchAt: Date | null }, now: Date) {
  return lead.firstTouchAt ? { lastActivityAt: now, updatedAt: now } : { firstTouchAt: now, lastActivityAt: now, updatedAt: now };
}

/** Recomputes the denormalised next follow-up time from pending follow-ups. */
export async function refreshNextFollowUp(db: DbOrTx, leadId: string) {
  const [row] = await db
    .select({ next: sql<Date | null>`min(${followUps.dueAt})` })
    .from(followUps)
    .where(and(eq(followUps.leadId, leadId), eq(followUps.status, "pending")));
  await db
    .update(leads)
    .set({ nextFollowUpAt: row?.next ? new Date(row.next) : null })
    .where(eq(leads.id, leadId));
}

export function isUniqueViolation(error: unknown, constraint?: string) {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = e?.code ? e : e?.cause;
  return pg?.code === "23505" && (!constraint || pg.constraint === constraint);
}

export const orNull = (conditions: (SQL | undefined)[]) => {
  const list = conditions.filter((c): c is SQL => Boolean(c));
  return list.length ? or(...list) : undefined;
};
