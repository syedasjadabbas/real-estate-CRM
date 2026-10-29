import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, bookingStageHistory, bookings, leads, projects, units } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { ensureClientForLead } from "@/modules/clients/commands";
import { parse } from "@/modules/clients/support";
import { transitionUnitStatus, reserveAvailableUnit } from "@/modules/inventory/status";
import { STAGE_LABELS } from "@/modules/leads/constants";
import { isUniqueViolation, loadAccessibleLead, logActivity, teamMemberIds, type DbOrTx, type Tx } from "@/modules/leads/support";
import { BOOKING_STAGE_LABELS, CLOSED_STAGES, nextStage, type BookingStage } from "./constants";
import { assertCanBooking, canAccessBooking, canMoveTo } from "./policy";
import { netPaid } from "@/modules/finance/ledger";
import { businessToday } from "./today";
import { advanceSchema, cancelSchema, createBookingSchema, updateBookingSchema } from "./validation";

const fieldError = (field: string, message: string) => new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { [field]: message } });

async function auditBooking(db: DbOrTx, actor: Actor, action: string, entityId: string, before: unknown, after: unknown) {
  await db.insert(auditLogs).values({ actorId: actor.id, action, entity: "booking", entityId, before: before ?? null, after: after ?? null });
}

/** Moves the lead to `to` with history and audit, as the Leads module records stage changes. */
async function setLeadStage(tx: Tx, actor: Actor, leadId: string, to: "booking_in_process" | "booked", reason: string) {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
  if (lead.stage === to) return lead;
  const now = new Date();
  await tx
    .update(leads)
    .set({ stage: to, stageChangedAt: now, lastActivityAt: now, updatedAt: now, ...(lead.firstTouchAt ? {} : { firstTouchAt: now }) })
    .where(eq(leads.id, leadId));
  await logActivity(tx, {
    leadId,
    actorId: actor.id,
    type: "stage_change",
    data: { from: lead.stage, to, fromLabel: STAGE_LABELS[lead.stage], toLabel: STAGE_LABELS[to], reason },
  });
  await tx.insert(auditLogs).values({ actorId: actor.id, action: "lead.stage", entity: "lead", entityId: leadId, before: { stage: lead.stage }, after: { stage: to, reason } });
  return lead;
}

async function loadAccessibleBooking(tx: DbOrTx, actor: Actor, bookingId: string, forUpdate = false) {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) throw notFound("Booking");
  const query = tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  const [booking] = forUpdate ? await query.for("update") : await query;
  if (!booking) throw notFound("Booking");
  const members = await teamMemberIds(tx, actor);
  if (!canAccessBooking(actor, booking.agentId, members)) throw notFound("Booking");
  return booking;
}

/** Stage write guarded on the stage the caller saw, so concurrent moves can't both succeed. */
async function writeStage(tx: Tx, bookingId: string, from: BookingStage, to: BookingStage, extra: Partial<typeof bookings.$inferInsert> = {}) {
  const [row] = await tx
    .update(bookings)
    .set({ stage: to, stageChangedAt: sql`now()`, updatedAt: sql`now()`, ...extra })
    .where(and(eq(bookings.id, bookingId), eq(bookings.stage, from)))
    .returning({ id: bookings.id });
  if (!row) throw new AppError("CONFLICT", "This booking was changed by someone else. Reload and try again.");
}

/**
 * FR-080 create: an Available whole unit in the lead's project. The unit is claimed with the guarded
 * transition (concurrent attempts: exactly one wins, the others get CONFLICT) and the partial unique
 * index backs that up. The lead moves to Booking in Process.
 */
export async function createBooking(db: Database, actor: Actor, input: unknown) {
  assertCanBooking(actor, "create");
  const data = parse(createBookingSchema, input);
  if (data.reservedUntil && data.reservedUntil < businessToday()) throw fieldError("reservedUntil", "Pick today or a later date");

  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, data.projectId)).limit(1);
    if (!project || project.status !== "active") throw fieldError("projectId", "Choose an active project");
    // Visibility check without a lock; the lead row is locked after the unit, matching confirm's lock order.
    const { lead } = await loadAccessibleLead(tx, actor, data.leadId);
    if (lead.projectId !== data.projectId) throw fieldError("leadId", "This lead belongs to another project");
    if (lead.stage === "lost_lead" || lead.stage === "booked") {
      throw new AppError("BUSINESS_RULE", `A ${STAGE_LABELS[lead.stage].toLowerCase()} lead can't be booked.`);
    }
    const [unit] = await tx.select().from(units).where(eq(units.id, data.unitId)).limit(1);
    if (!unit || unit.projectId !== data.projectId) throw fieldError("unitId", "Choose an available unit in this project");

    const totalSale = Math.round(unit.areaSqft * data.ratePerSqft * 100) / 100;
    if (data.tokenAmount > totalSale) throw fieldError("tokenAmount", "The token can't exceed the total sale");

    await reserveAvailableUnit(tx, unit.id, actor.id, `Booking for lead ${lead.code}`);
    const values = {
      projectId: data.projectId,
      unitId: unit.id,
      leadId: lead.id,
      agentId: lead.ownerId ?? actor.id,
      ratePerSqft: data.ratePerSqft,
      areaSqft: unit.areaSqft,
      totalSale,
      tokenAmount: data.tokenAmount,
      reservedUntil: data.reservedUntil ?? null,
      paymentInstructions: data.paymentInstructions ?? null,
      createdById: actor.id,
    };
    let created: { id: string };
    try {
      [created] = await tx.transaction((sp) => sp.insert(bookings).values(values).returning({ id: bookings.id }));
    } catch (error) {
      if (isUniqueViolation(error, "bookings_one_active_per_unit_uq")) throw new AppError("CONFLICT", "This unit already has an active booking.");
      throw error;
    }
    await tx.insert(bookingStageHistory).values({ bookingId: created.id, fromStage: null, toStage: "negotiation", actorId: actor.id, note: "Booking created" });
    await setLeadStage(tx, actor, lead.id, "booking_in_process", "Booking created");
    await auditBooking(tx, actor, "booking.create", created.id, null, { ...values, stage: "negotiation", unitNo: unit.unitNo, leadCode: lead.code });
    return { bookingId: created.id };
  });
}

/**
 * FR-082: one step forward at a time (decision 29 Oct 2026). Agents may go up to Sales order;
 * Confirmed needs the confirm permission and sets unit → Booked, lead → Booked, and links or
 * creates the client (FR-050).
 */
export async function advanceBooking(db: Database, actor: Actor, bookingId: string, input: unknown) {
  assertCanBooking(actor, "advance");
  const { toStage, note } = parse(advanceSchema, input);
  return db.transaction(async (tx) => {
    const booking = await loadAccessibleBooking(tx, actor, bookingId, true);
    if (CLOSED_STAGES.includes(booking.stage)) throw new AppError("BUSINESS_RULE", `This booking is ${BOOKING_STAGE_LABELS[booking.stage].toLowerCase()}.`);
    if (toStage === "cancelled") throw new AppError("BUSINESS_RULE", "Use Cancel booking, which needs a reason.");
    const expected = nextStage(booking.stage);
    if (toStage !== expected) {
      throw new AppError("BUSINESS_RULE", `Bookings move one stage at a time. The next stage is ${expected ? BOOKING_STAGE_LABELS[expected] : "none"}.`);
    }
    if (!canMoveTo(actor, toStage)) {
      throw forbidden(toStage === "confirmed" ? "Only managers and admins can confirm bookings." : "Agents can move bookings up to Sales order.");
    }

    let clientId = booking.clientId;
    if (toStage === "confirmed") {
      await transitionUnitStatus(tx, { unitId: booking.unitId, from: ["reserved"], to: "booked", actorId: actor.id, source: "booking", reason: "Booking confirmed" });
      const lead = await setLeadStage(tx, actor, booking.leadId, "booked", "Booking confirmed");
      clientId = (await ensureClientForLead(tx, actor, lead, booking.id)).clientId;
      await writeStage(tx, booking.id, booking.stage, toStage, { confirmedAt: new Date(), clientId });
    } else {
      await writeStage(tx, booking.id, booking.stage, toStage);
    }
    await tx.insert(bookingStageHistory).values({ bookingId: booking.id, fromStage: booking.stage, toStage, actorId: actor.id, note: note ?? null });
    await auditBooking(tx, actor, toStage === "confirmed" ? "booking.confirm" : "booking.stage", booking.id, { stage: booking.stage }, { stage: toStage, note: note ?? null, clientId });
    return { from: booking.stage, to: toStage, clientId };
  });
}

/** Cancel from any open stage (managers for their team, admins): releases the unit; the lead is left as is (decision 29 Oct 2026). */
export async function cancelBooking(db: Database, actor: Actor, bookingId: string, input: unknown) {
  assertCanBooking(actor, "cancel");
  const { reason } = parse(cancelSchema, input);
  return db.transaction(async (tx) => {
    const booking = await loadAccessibleBooking(tx, actor, bookingId, true);
    if (CLOSED_STAGES.includes(booking.stage)) {
      throw new AppError("BUSINESS_RULE", `A ${BOOKING_STAGE_LABELS[booking.stage].toLowerCase()} booking can't be cancelled.`);
    }
    // Proposed Q-F10 default: money received can't be cancelled away silently. Refund / credit / retention
    // rules are not approved yet, so a booking with net payments can't be cancelled at all for now.
    const paid = await netPaid(tx, booking.id);
    if (paid > 0) {
      throw new AppError(
        "BUSINESS_RULE",
        `PKR ${new Intl.NumberFormat("en-US").format(paid)} has been received on this booking. It can't be cancelled until a refund, credit or retention is approved (rules pending).`,
        { details: { paid } },
      );
    }
    await writeStage(tx, booking.id, booking.stage, "cancelled", { cancelledAt: new Date(), cancelledReason: reason });
    await transitionUnitStatus(tx, { unitId: booking.unitId, from: ["reserved"], to: "available", actorId: actor.id, source: "booking", reason: `Booking cancelled: ${reason}` });
    await tx.insert(bookingStageHistory).values({ bookingId: booking.id, fromStage: booking.stage, toStage: "cancelled", actorId: actor.id, note: reason });
    await auditBooking(tx, actor, "booking.cancel", booking.id, { stage: booking.stage }, { stage: "cancelled", reason });
    return { from: booking.stage };
  });
}

/** Overview fields (managers / admins). Rate and token stay fixed; cancelled bookings are read-only. */
export async function updateBookingDetails(db: Database, actor: Actor, bookingId: string, input: unknown) {
  assertCanBooking(actor, "editDetails");
  const data = parse(updateBookingSchema, input);
  return db.transaction(async (tx) => {
    const booking = await loadAccessibleBooking(tx, actor, bookingId, true);
    if (booking.stage === "cancelled") throw new AppError("BUSINESS_RULE", "A cancelled booking can't be edited.");
    const changes: Partial<typeof bookings.$inferInsert> = {};
    for (const key of ["reservedUntil", "paymentInstructions", "agreementSentOn"] as const) {
      if (key in data) changes[key] = data[key] ?? null;
    }
    if (data.paymentDocsStatus !== undefined) changes.paymentDocsStatus = data.paymentDocsStatus;
    const changed = Object.keys(changes).filter(
      (k) => String(changes[k as keyof typeof changes] ?? "") !== String(booking[k as keyof typeof booking] ?? ""),
    );
    if (changed.length === 0) return { changed: [] as string[] };
    if (changed.includes("reservedUntil") && changes.reservedUntil && changes.reservedUntil < businessToday()) {
      throw fieldError("reservedUntil", "Pick today or a later date");
    }
    await tx.update(bookings).set({ ...changes, updatedAt: new Date() }).where(eq(bookings.id, bookingId));
    await auditBooking(
      tx,
      actor,
      "booking.update",
      bookingId,
      Object.fromEntries(changed.map((k) => [k, booking[k as keyof typeof booking]])),
      Object.fromEntries(changed.map((k) => [k, changes[k as keyof typeof changes]])),
    );
    return { changed };
  });
}
