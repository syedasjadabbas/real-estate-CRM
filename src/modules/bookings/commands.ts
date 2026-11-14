import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { canDoFinance } from "@/modules/finance/policy";
import { notify } from "@/modules/notifications/service";
import { getProposalSettings } from "@/modules/tasks/settings";
import { unitPricePerSqft } from "@/modules/tasks/plan";
import { discountCap } from "@/modules/tasks/policy";
import { assertWorkable } from "@/modules/leads/verification";
import type { Database } from "@/server/db";
import { auditLogs, bookingStageHistory, bookings, files, leads, projects, units, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { ensureClientForLead, linkExistingClient } from "@/modules/clients/commands";
import { parse } from "@/modules/clients/support";
import { transitionUnitStatus, reserveAvailableUnit } from "@/modules/inventory/status";
import { STAGE_LABELS } from "@/modules/leads/constants";
import { isUniqueViolation, loadAccessibleLead, logActivity, teamMemberIds, type DbOrTx, type Tx } from "@/modules/leads/support";
import { BOOKING_STAGE_LABELS, CLOSED_STAGES, nextStage, type BookingStage, FIRST_STAGE } from "./constants";
import { assertCanBooking, canAccessBooking, canMoveTo } from "./policy";
import { netPaid } from "@/modules/finance/ledger";
import { businessToday, defaultHoldUntil } from "./today";
import { advanceSchema, cancelSchema, createBookingSchema, updateBookingSchema } from "./validation";

const fieldError = (field: string, message: string) => new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { [field]: message } });

async function auditBooking(db: DbOrTx, actor: Actor, action: string, entityId: string, before: unknown, after: unknown) {
  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action, entity: "booking", entityId, before: before ?? null, after: after ?? null });
}

/** Moves the lead to `to` with history and audit, as the Leads module records stage changes. */
async function setLeadStage(tx: Tx, actor: Actor, leadId: string, to: "booking_in_process" | "booked", reason: string) {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
  if (lead.stage === to) return lead;
  // Re-checked under the lock: the lead may have been marked Lost (or booked) since createBooking
  // read it. Throwing rolls back the whole booking, including the unit reservation.
  if (to === "booking_in_process" && (lead.stage === "lost_lead" || lead.stage === "booked")) {
    throw new AppError("CONFLICT", `The lead was marked ${STAGE_LABELS[lead.stage]} while the booking was being created. Reload and try again.`);
  }
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
  await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "lead.stage", entity: "lead", entityId: leadId, before: { stage: lead.stage }, after: { stage: to, reason } });
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
 * index backs that up. The lead moves to Booking in Process. Reserved until defaults to HOLD_DAYS from today (FR-081).
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
    assertWorkable(actor, lead);
    if (lead.projectId !== data.projectId) throw fieldError("leadId", "This lead belongs to another project");
    if (lead.stage === "lost_lead" || lead.stage === "booked") {
      throw new AppError("BUSINESS_RULE", `A ${STAGE_LABELS[lead.stage].toLowerCase()} lead can't be booked.`);
    }
    const [unit] = await tx.select().from(units).where(eq(units.id, data.unitId)).limit(1);
    if (!unit || unit.projectId !== data.projectId) throw fieldError("unitId", "Choose an available unit in this project");

    // Price from inventory (owner, 14 Nov 2026). Up to the role's cap (agents 5%) the discount applies at
    // once; more waits for an Admin or Super Admin, with the booking held at the cap meanwhile.
    const priceSettings = await getProposalSettings(tx);
    const listRate = unitPricePerSqft(unit, priceSettings);
    const cap = discountCap(actor.role, priceSettings);
    let ratePerSqft: number;
    let totalSale: number;
    let discountPct = 0;
    let requestedPct: number | null = null;
    if (listRate === null) {
      // No inventory price and no default rate configured: the rate is typed in, as before.
      if (data.ratePerSqft === undefined) throw fieldError("ratePerSqft", "This unit has no inventory price: enter the per sq ft rate");
      ratePerSqft = data.ratePerSqft;
      totalSale = Math.round(unit.areaSqft * ratePerSqft * 100) / 100;
    } else if (data.ratePerSqft !== undefined) {
      // A typed rate (API): no lower than the inventory rate less the cap.
      const lowest = Math.round(listRate * (1 - cap / 100) * 100) / 100;
      if (data.ratePerSqft < lowest) throw fieldError("ratePerSqft", `At least ${lowest.toLocaleString("en-US")} per sq ft (inventory rate less your ${cap}% limit)`);
      ratePerSqft = data.ratePerSqft;
      totalSale = Math.round(unit.areaSqft * ratePerSqft * 100) / 100;
      discountPct = Math.max(0, Math.round((1 - ratePerSqft / listRate) * 10000) / 100);
    } else {
      const asked = data.discountPct ?? 0;
      if (asked > cap) requestedPct = asked;
      discountPct = Math.min(asked, cap);
      ({ ratePerSqft, totalSale } = discountedPrice(unit, listRate, discountPct));
    }
    if (data.tokenAmount < MIN_TOKEN_PKR) throw fieldError("tokenAmount", `The token must be at least PKR ${MIN_TOKEN_PKR.toLocaleString("en-US")}`);
    if (data.tokenAmount > totalSale) throw fieldError("tokenAmount", "The token can't exceed the total sale");

    await reserveAvailableUnit(tx, unit.id, actor.id, `Booking for lead ${lead.code}`, actor.ip ?? null);
    const values = {
      projectId: data.projectId,
      unitId: unit.id,
      leadId: lead.id,
      agentId: lead.ownerId ?? actor.id,
      ratePerSqft,
      areaSqft: unit.areaSqft,
      totalSale,
      tokenAmount: data.tokenAmount,
      // FR-081: a hold ends HOLD_DAYS after creation unless the creator picks another date.
      reservedUntil: data.reservedUntil ?? defaultHoldUntil(),
      paymentInstructions: data.paymentInstructions ?? null,
      discountPct,
      discountRequestedPct: requestedPct,
      discountStatus: requestedPct !== null ? ("pending" as const) : ("none" as const),
      createdById: actor.id,
    };
    let created: { id: string };
    try {
      [created] = await tx.transaction((sp) => sp.insert(bookings).values(values).returning({ id: bookings.id }));
    } catch (error) {
      if (isUniqueViolation(error, "bookings_one_active_per_unit_uq")) throw new AppError("CONFLICT", "This unit already has an active booking.");
      throw error;
    }
    await tx.insert(bookingStageHistory).values({
      bookingId: created.id,
      fromStage: null,
      toStage: FIRST_STAGE,
      actorId: actor.id,
      note:
        requestedPct !== null
          ? `Booking created · ${requestedPct}% discount asked; ${discountPct}% until an Admin approves`
          : discountPct > 0
            ? `Booking created · ${discountPct}% discount on the inventory price`
            : "Booking created",
    });
    const lockedLead = await setLeadStage(tx, actor, lead.id, "booking_in_process", "Booking created");
    // F-13: a buyer who is already a client sees this booking at once; a new buyer's client still waits for confirmation (FR-050).
    const clientId = await linkExistingClient(tx, actor, lockedLead, created.id);
    await auditBooking(tx, actor, "booking.create", created.id, null, { ...values, stage: FIRST_STAGE, unitNo: unit.unitNo, leadCode: lead.code, clientId, listRate, discountPct });
    if (requestedPct !== null) {
      const approvers = await tx.select({ id: users.id }).from(users).where(and(eq(users.status, "active"), inArray(users.role, ["admin", "super_admin"])));
      await notify(
        tx,
        approvers.map((u) => ({
          userId: u.id,
          type: "discount_requested" as const,
          title: `Discount to approve: ${requestedPct}% on unit ${unit.unitNo}`,
          body: `${actor.name} asked ${requestedPct}% for ${lead.name} (${lead.code}). Held at ${discountPct}% until decided.`,
          link: `/dashboard/bookings/${created.id}`,
          dedupeKey: `discount_requested:${created.id}`,
        })),
        actor.id,
      );
    }
    return { bookingId: created.id, discountStatus: values.discountStatus };
  });
}

/**
 * The price at a discount, from the unit's total price when inventory has one (so 0% is exactly the
 * inventory price, without per-sq-ft rounding), else from the rate.
 */
function discountedPrice(unit: { areaSqft: number; basePrice: number }, listRate: number, pct: number) {
  const listTotal = unit.basePrice > 0 ? unit.basePrice : Math.round(listRate * unit.areaSqft * 100) / 100;
  const totalSale = Math.round(listTotal * (1 - pct / 100) * 100) / 100;
  return { totalSale, ratePerSqft: Math.round((totalSale / unit.areaSqft) * 100) / 100 };
}

/**
 * Discount approval (owner, 14 Nov 2026): an Admin or Super Admin approves the asked discount (the
 * price moves to it) or rejects it (the booking stays at the agent's cap). The agent is told.
 */
export async function decideDiscount(db: Database, actor: Actor, bookingId: string, input: { approve?: unknown; note?: unknown }) {
  if (actor.role !== "admin" && actor.role !== "super_admin") throw forbidden("Only an Admin or Super Admin decides discounts.");
  const approve = input.approve === true;
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
  if (!approve && !note) throw new AppError("VALIDATION_FAILED", "Give a reason for rejecting.", { fields: { note: "Give a reason" } });
  return db.transaction(async (tx) => {
    const booking = await loadAccessibleBooking(tx, actor, bookingId, true);
    if (booking.discountStatus !== "pending" || booking.discountRequestedPct === null) throw new AppError("BUSINESS_RULE", "No discount is waiting for a decision.");
    if (booking.stage === "cancelled") throw new AppError("BUSINESS_RULE", "This booking is cancelled.");
    const now = new Date();
    const changes: Partial<typeof bookings.$inferInsert> = { discountStatus: approve ? "approved" : "rejected", discountDecidedById: actor.id, discountDecidedAt: now, discountNote: note || null, updatedAt: now };
    if (approve) {
      const [unit] = await tx.select().from(units).where(eq(units.id, booking.unitId)).limit(1);
      const listRate = unitPricePerSqft(unit, await getProposalSettings(tx));
      if (listRate === null) throw new AppError("BUSINESS_RULE", "This unit has no inventory price.");
      const price = discountedPrice(unit, listRate, booking.discountRequestedPct);
      if (await netPaid(tx, booking.id) > price.totalSale) throw new AppError("BUSINESS_RULE", "More has been paid than the discounted total.");
      Object.assign(changes, { discountPct: booking.discountRequestedPct, totalSale: price.totalSale, ratePerSqft: price.ratePerSqft });
    }
    await tx.update(bookings).set(changes).where(eq(bookings.id, booking.id));
    await tx.insert(bookingStageHistory).values({
      bookingId: booking.id,
      fromStage: booking.stage,
      toStage: booking.stage,
      actorId: actor.id,
      note: approve ? `Discount of ${booking.discountRequestedPct}% approved` : `Discount of ${booking.discountRequestedPct}% rejected; stays at ${booking.discountPct}%. ${note}`,
    });
    await auditBooking(tx, actor, approve ? "booking.discount_approve" : "booking.discount_reject", booking.id, { discountPct: booking.discountPct, totalSale: booking.totalSale }, { ...changes, note: note || null });
    const told = booking.agentId ?? booking.createdById;
    if (told) {
      await notify(
        tx,
        [{
          userId: told,
          type: "discount_decided",
          title: approve ? `Discount approved: ${booking.discountRequestedPct}%` : `Discount rejected: stays at ${booking.discountPct}%`,
          body: approve ? "The booking's price now uses the approved discount." : `Reason: ${note}`,
          link: `/dashboard/bookings/${booking.id}`,
          dedupeKey: `discount_decided:${booking.id}`,
        }],
        actor.id,
      );
    }
    return { status: changes.discountStatus };
  });
}

/**
 * FR-082: one step forward at a time (decision 29 Oct 2026). Agents may go up to Sales order;
 * Confirmed needs the confirm permission and sets unit → Booked, lead → Booked, and links or
 * creates the client (FR-050).
 */
export async function advanceBooking(db: Database, actor: Actor, bookingId: string, input: unknown) {
  assertCanBooking(actor, "advance");
  const { toStage, note, proofFileId, amount } = parse(advanceSchema, input);
  return db.transaction(async (tx) => {
    const booking = await loadAccessibleBooking(tx, actor, bookingId, true);
    if (CLOSED_STAGES.includes(booking.stage)) throw new AppError("BUSINESS_RULE", `This booking is ${BOOKING_STAGE_LABELS[booking.stage].toLowerCase()}.`);
    if (toStage === "cancelled") throw new AppError("BUSINESS_RULE", "Use Cancel booking, which needs a reason.");
    if (booking.discountStatus === "pending") throw new AppError("BUSINESS_RULE", "The discount is waiting for an Admin or Super Admin. The booking moves on once it is decided.");
    const expected = nextStage(booking.stage);
    if (toStage !== expected) {
      throw new AppError("BUSINESS_RULE", `Bookings move one stage at a time. The next stage is ${expected ? BOOKING_STAGE_LABELS[expected] : "none"}.`);
    }
    // The steps of a booking (owner, 14 Nov 2026):
    // - Token → Partial Down Payment, and → Complete Down Payment: the amount received and a new payment proof.
    // - Leaving Partial or Complete Down Payment: the booking form generated in that stage, signed by the
    //   client and uploaded during it.
    const paymentMove = toStage === "down_payment" || toStage === "agreement_pending";
    if (booking.stage === "down_payment" || booking.stage === "agreement_pending") {
      const [signed] = await tx
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.bookingId, booking.id), eq(files.kind, "document"), isNull(files.deletedAt), gte(files.createdAt, booking.stageChangedAt)))
        .limit(1);
      if (!signed) {
        throw new AppError("VALIDATION_FAILED", `Upload the booking form signed by the client for ${BOOKING_STAGE_LABELS[booking.stage]} first.`, { fields: { signedForm: "Upload the signed booking form" } });
      }
    }
    if (paymentMove && !amount) throw new AppError("VALIDATION_FAILED", "Enter the amount received.", { fields: { amount: "Enter the amount received" } });
    let proofName: string | null = null;
    if (proofFileId || paymentMove) {
      if (!proofFileId) throw new AppError("VALIDATION_FAILED", "Attach the payment proof for this payment.", { fields: { proof: "Attach the payment proof" } });
      const [proof] = await tx
        .select({ name: files.originalName, createdAt: files.createdAt })
        .from(files)
        .where(and(eq(files.id, proofFileId), eq(files.bookingId, booking.id), eq(files.kind, "receipt"), isNull(files.deletedAt)))
        .limit(1);
      if (!proof || proof.createdAt < booking.stageChangedAt) {
        throw new AppError("VALIDATION_FAILED", "Attach a new payment proof for this payment.", { fields: { proof: "Attach a new payment proof" } });
      }
      proofName = proof.name;
    }
    if (!canMoveTo(actor, toStage)) {
      throw forbidden(toStage === "confirmed" ? "Only managers and admins can confirm bookings." : "Agents can move bookings up to Sales order.");
    }

    let clientId = booking.clientId;
    if (toStage === "confirmed") {
      await transitionUnitStatus(tx, { unitId: booking.unitId, from: ["reserved"], to: "booked", actorId: actor.id, ip: actor.ip ?? null, source: "booking", reason: "Booking confirmed" });
      const lead = await setLeadStage(tx, actor, booking.leadId, "booked", "Booking confirmed");
      clientId = (await ensureClientForLead(tx, actor, lead, booking.id)).clientId;
      await writeStage(tx, booking.id, booking.stage, toStage, { confirmedAt: new Date(), clientId });
    } else {
      await writeStage(tx, booking.id, booking.stage, toStage);
    }
    const historyNote = [amount ? `Amount received: PKR ${amount.toLocaleString("en-US")}` : null, proofName ? `Payment proof: ${proofName}` : null, note].filter(Boolean).join(" · ") || null;
    await tx.insert(bookingStageHistory).values({ bookingId: booking.id, fromStage: booking.stage, toStage, actorId: actor.id, note: historyNote });
    await auditBooking(tx, actor, toStage === "confirmed" ? "booking.confirm" : "booking.stage", booking.id, { stage: booking.stage }, { stage: toStage, note: note ?? null, clientId, proofFileId: proofFileId ?? null, amount: amount ?? null });
    return { from: booking.stage, to: toStage, clientId };
  });
}

/** Cancel from any open stage (managers for their team, admins): releases the unit; the lead is left as is (decision 29 Oct 2026). */
/** Smallest token a booking may be made with (owner, 14 Nov 2026). */
export const MIN_TOKEN_PKR = 20_000;

/**
 * Finance rejects a booking whose token payment isn't genuine (owner, 14 Nov 2026): the booking is
 * cancelled with the reason, the unit is freed and the agent is told. Only before any payment is posted
 * (a posted one is undone with a reversal). Accountants and Super Admins, who record payments.
 */
export async function rejectBookingPayment(db: Database, actor: Actor, bookingId: string, input: unknown) {
  if (!canDoFinance(actor, "record")) throw forbidden("Only Accounts can reject a booking's payment.");
  const { reason } = parse(cancelSchema, input);
  return db.transaction(async (tx) => {
    const booking = await loadAccessibleBooking(tx, actor, bookingId, true);
    if (CLOSED_STAGES.includes(booking.stage)) {
      throw new AppError("BUSINESS_RULE", `A ${BOOKING_STAGE_LABELS[booking.stage].toLowerCase()} booking can't be rejected.`);
    }
    if ((await netPaid(tx, booking.id)) > 0) {
      throw new AppError("BUSINESS_RULE", "A payment has already been posted on this booking. Request a reversal of that payment instead.");
    }
    const note = `Payment rejected by Accounts: ${reason}`;
    await writeStage(tx, booking.id, booking.stage, "cancelled", { cancelledAt: new Date(), cancelledReason: note });
    await transitionUnitStatus(tx, { unitId: booking.unitId, from: ["reserved"], to: "available", actorId: actor.id, ip: actor.ip ?? null, source: "booking", reason: note });
    await tx.insert(bookingStageHistory).values({ bookingId: booking.id, fromStage: booking.stage, toStage: "cancelled", actorId: actor.id, note });
    await auditBooking(tx, actor, "booking.payment_reject", booking.id, { stage: booking.stage }, { stage: "cancelled", reason });
    if (booking.agentId) {
      await notify(
        tx,
        [{ userId: booking.agentId, type: "booking_rejected", title: "Booking rejected: payment not verified", body: reason, link: `/dashboard/bookings/${booking.id}`, dedupeKey: `booking_rejected:${booking.id}` }],
        actor.id,
      );
    }
    return { from: booking.stage };
  });
}

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
    await transitionUnitStatus(tx, { unitId: booking.unitId, from: ["reserved"], to: "available", actorId: actor.id, ip: actor.ip ?? null, source: "booking", reason: `Booking cancelled: ${reason}` });
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
