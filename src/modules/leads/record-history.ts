import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, bookings, meetings, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { canAccessBooking, canDoBooking } from "@/modules/bookings/policy";
import { teamMemberIds } from "./support";

const EDITS = ["booking.create", "booking.stage", "booking.confirm", "booking.cancel", "booking.update", "booking.discount_approve", "booking.discount_reject", "booking.payment_reject", "booking.proof_upload", "booking.signed_form_upload"];

/**
 * What happened to the lead's bookings and meetings, for its timeline (client, 24 Nov 2026). Read from the
 * audit log rather than stored twice, so it also covers everything before this was added. Bookings the
 * actor can't open are left out; payments stay in Finance.
 */
export async function recordHistory(db: Database, actor: Actor, leadId: string) {
  const members = await teamMemberIds(db, actor);
  const [booked, met] = await Promise.all([
    db.select({ id: bookings.id, agentId: bookings.agentId }).from(bookings).where(eq(bookings.leadId, leadId)),
    db.select({ id: meetings.id }).from(meetings).where(eq(meetings.leadId, leadId)),
  ]);
  const bookingIds = canDoBooking(actor, "view") ? booked.filter((b) => canAccessBooking(actor, b.agentId, members)).map((b) => b.id) : [];
  const meetingIds = met.map((m) => m.id);
  const parts = [
    bookingIds.length ? and(eq(auditLogs.entity, "booking"), inArray(auditLogs.entityId, bookingIds), inArray(auditLogs.action, EDITS)) : undefined,
    meetingIds.length ? and(eq(auditLogs.entity, "meeting"), inArray(auditLogs.entityId, meetingIds), eq(auditLogs.action, "meeting.update")) : undefined,
  ].filter((p) => p !== undefined);
  if (parts.length === 0) return [];
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityId: auditLogs.entityId,
      before: auditLogs.before,
      after: auditLogs.after,
      createdAt: auditLogs.createdAt,
      actorName: users.name,
      actorRole: users.role,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(or(...parts))
    .orderBy(desc(auditLogs.createdAt), sql`${auditLogs.id}`);
  return rows.map(({ action, entityId, before, after, ...r }) => ({
    ...r,
    type: "record_change" as const,
    body: null,
    data: { action, recordId: entityId, before, after } as Record<string, unknown>,
  }));
}
