import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, bookings, leadActivities, leads } from "@/server/db/schema";
import { OPEN_STAGES, STAGE_LABELS, type LeadStage } from "@/modules/leads/constants";

// Kept free of the wider app graph, like hold-release.ts, so the scheduled job can load it.
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * A booking that ends without a sale (cancelled, rejected or its hold expired) sends its lead back to the
 * stage it was booked from (24 Nov 2026; before, 29 Oct 2026, the lead was left in Booking in Process).
 * Nothing moves when another booking is open, or when that stage isn't recorded. Call after the booking is
 * closed and the unit released (lock order booking, unit, lead).
 */
export async function returnLead(tx: Tx, leadId: string, actor: { id: string | null; ip?: string | null }, reason: string, now = new Date()) {
  const [lead] = await tx.select({ stage: leads.stage }).from(leads).where(eq(leads.id, leadId)).for("update");
  if (!lead || lead.stage !== "booking_in_process") return null;
  const [open] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.leadId, leadId), notInArray(bookings.stage, ["confirmed", "cancelled"])))
    .limit(1);
  if (open) return null;
  const [move] = await tx
    .select({ from: sql<string | null>`${leadActivities.data}->>'from'` })
    .from(leadActivities)
    .where(and(eq(leadActivities.leadId, leadId), eq(leadActivities.type, "stage_change"), sql`${leadActivities.data}->>'to' = 'booking_in_process'`))
    .orderBy(desc(leadActivities.createdAt))
    .limit(1);
  const to = OPEN_STAGES.find((s): s is LeadStage => s === move?.from && s !== "booking_in_process");
  if (!to) return null;
  await tx.update(leads).set({ stage: to, stageChangedAt: now, updatedAt: now }).where(eq(leads.id, leadId));
  await tx.insert(leadActivities).values({
    leadId,
    actorId: actor.id,
    type: "stage_change",
    data: { from: lead.stage, to, fromLabel: STAGE_LABELS[lead.stage], toLabel: STAGE_LABELS[to], reason },
  });
  await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "lead.stage", entity: "lead", entityId: leadId, before: { stage: lead.stage }, after: { stage: to, reason } });
  return to;
}
