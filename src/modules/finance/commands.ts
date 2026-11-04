import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, bookingPayments, bookings, financeSettings, paymentMethods, paymentReversalRequests } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, notFound } from "@/server/errors";
import { canAccessBooking } from "@/modules/bookings/policy";
import { BOOKING_STAGE_LABELS } from "@/modules/bookings/constants";
import { businessToday } from "@/modules/bookings/today";
import { parse } from "@/modules/clients/support";
import { isUniqueViolation, teamMemberIds, type DbOrTx } from "@/modules/leads/support";
import { PAYABLE_STAGES } from "./constants";
import { netPaid, toPaisa } from "./ledger";
import { assertCanFinance } from "./policy";
import { financeSettingsSchema, paymentMethodSchema, recordPaymentSchema, reversalDecisionSchema, reversalRequestSchema } from "./validation";

const fieldError = (field: string, message: string) => new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { [field]: message } });
const isId = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const formatPkr = (n: number) => `PKR ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)}`;

async function audit(db: DbOrTx, actor: Actor, action: string, entity: string, entityId: string, before: unknown, after: unknown) {
  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action, entity, entityId, before: before ?? null, after: after ?? null });
}

/**
 * FR-202: post a payment against a booking. The booking row is locked for the whole transaction, so
 * concurrent payments on one booking serialise and each sees the others' amounts; the amount may not
 * exceed the outstanding balance (proposed Q-F12 default). Receipt numbers come from a sequence:
 * unique and never reused; a rolled-back attempt leaves a gap, which the Q-F3 default allows.
 */
export async function recordPayment(db: Database, actor: Actor, input: unknown) {
  assertCanFinance(actor, "record");
  const data = parse(recordPaymentSchema, input);
  if (data.receivedOn > businessToday()) throw fieldError("receivedOn", "The payment date can't be in the future");

  const replay = async () => {
    if (!data.idempotencyKey) return null;
    const [existing] = await db
      .select()
      .from(bookingPayments)
      .where(and(eq(bookingPayments.recordedById, actor.id), eq(bookingPayments.idempotencyKey, data.idempotencyKey)));
    if (!existing) return null;
    if (existing.bookingId !== data.bookingId || toPaisa(existing.amount) !== toPaisa(data.amount)) {
      throw new AppError("CONFLICT", "This request key was already used for a different payment.");
    }
    return { paymentId: existing.id, receiptNo: existing.receiptNo!, replayed: true };
  };
  const earlier = await replay();
  if (earlier) return earlier;

  try {
    return await db.transaction(async (tx) => {
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, data.bookingId)).limit(1).for("update");
      if (!booking) throw fieldError("bookingId", "Choose a booking");
      if (!(PAYABLE_STAGES as readonly string[]).includes(booking.stage)) {
        throw new AppError("BUSINESS_RULE", `Payments can't be recorded on a booking in ${BOOKING_STAGE_LABELS[booking.stage]}.`);
      }
      const [method] = await tx.select().from(paymentMethods).where(eq(paymentMethods.id, data.methodId)).limit(1);
      if (!method || !method.isActive) throw fieldError("methodId", "Choose an active payment method");

      const paid = await netPaid(tx, booking.id);
      const outstanding = (toPaisa(booking.totalSale) - toPaisa(paid)) / 100;
      if (toPaisa(data.amount) > toPaisa(outstanding)) {
        throw fieldError("amount", outstanding > 0 ? `The amount exceeds the outstanding balance of ${formatPkr(outstanding)}` : "This booking is fully paid");
      }

      const [row] = await tx
        .insert(bookingPayments)
        .values({
          bookingId: booking.id,
          kind: "payment",
          type: data.type,
          amount: data.amount,
          receivedOn: data.receivedOn,
          methodId: method.id,
          reference: data.reference ?? null,
          note: data.note ?? null,
          receiptNo: sql`nextval('booking_payment_receipt_no_seq')`,
          idempotencyKey: data.idempotencyKey ?? null,
          recordedById: actor.id,
        })
        .returning({ id: bookingPayments.id, receiptNo: bookingPayments.receiptNo });
      await audit(tx, actor, "payment.record", "payment", row.id, null, {
        bookingId: booking.id,
        type: data.type,
        amount: data.amount,
        receivedOn: data.receivedOn,
        method: method.name,
        reference: data.reference ?? null,
        receiptNo: row.receiptNo,
        paidBefore: paid,
        paidAfter: (toPaisa(paid) + toPaisa(data.amount)) / 100,
      });
      return { paymentId: row.id, receiptNo: row.receiptNo!, replayed: false };
    });
  } catch (error) {
    // Two submissions with the same key raced: return the one that won.
    if (isUniqueViolation(error, "booking_payments_idempotency_uq")) {
      const winner = await replay();
      if (winner) return winner;
    }
    throw error;
  }
}

/** Step 1 of a correction (proposed Q-F2): the accountant asks, with a reason. Nothing changes yet. */
export async function requestReversal(db: Database, actor: Actor, paymentId: string, input: unknown) {
  assertCanFinance(actor, "requestReversal");
  const { reason } = parse(reversalRequestSchema, input);
  if (!isId(paymentId)) throw notFound("Payment");
  return db.transaction(async (tx) => {
    const [payment] = await tx.select().from(bookingPayments).where(eq(bookingPayments.id, paymentId)).limit(1);
    if (!payment) throw notFound("Payment");
    if (payment.kind !== "payment") throw new AppError("BUSINESS_RULE", "A reversal can't itself be reversed.");
    const [reversed] = await tx.select({ id: bookingPayments.id }).from(bookingPayments).where(eq(bookingPayments.reversalOfId, paymentId)).limit(1);
    if (reversed) throw new AppError("BUSINESS_RULE", "This payment has already been reversed.");
    let request: { id: string };
    try {
      [request] = await tx.transaction((sp) =>
        sp.insert(paymentReversalRequests).values({ paymentId, reason, requestedById: actor.id }).returning({ id: paymentReversalRequests.id }),
      );
    } catch (error) {
      if (isUniqueViolation(error, "payment_reversal_one_pending_uq")) throw new AppError("CONFLICT", "A reversal request for this payment is already waiting for approval.");
      throw error;
    }
    await audit(tx, actor, "payment.reversal_requested", "payment", paymentId, null, { requestId: request.id, reason, receiptNo: payment.receiptNo });
    return { requestId: request.id };
  });
}

/**
 * Step 2: a manager (own team's bookings) or admin approves or rejects. Approval posts a reversal row
 * that mirrors the original (enforced again by a database trigger) with its own reference number.
 * The requester can't approve their own request, except a super admin (emergency control, audited as such).
 */
export async function decideReversal(db: Database, actor: Actor, requestId: string, input: unknown) {
  assertCanFinance(actor, "decideReversal");
  const { approve, note } = parse(reversalDecisionSchema, input);
  if (!isId(requestId)) throw notFound("Reversal request");
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(paymentReversalRequests).where(eq(paymentReversalRequests.id, requestId)).limit(1).for("update");
    if (!request) throw notFound("Reversal request");
    const [payment] = await tx.select().from(bookingPayments).where(eq(bookingPayments.id, request.paymentId));
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, payment.bookingId)).for("update");
    const members = await teamMemberIds(tx, actor);
    if (!canAccessBooking(actor, booking.agentId, members)) throw notFound("Reversal request");
    if (request.status !== "pending") throw new AppError("BUSINESS_RULE", `This request was already ${request.status}.`);
    const selfApproval = request.requestedById === actor.id;
    if (selfApproval && actor.role !== "super_admin") throw new AppError("FORBIDDEN", "Someone other than the requester must decide this reversal.");

    await tx
      .update(paymentReversalRequests)
      .set({ status: approve ? "approved" : "rejected", decidedById: actor.id, decidedAt: new Date(), decisionNote: note ?? null })
      .where(eq(paymentReversalRequests.id, requestId));

    let reversalId: string | null = null;
    let reversalRef: number | null = null;
    if (approve) {
      const [row] = await tx
        .insert(bookingPayments)
        .values({
          bookingId: payment.bookingId,
          kind: "reversal",
          type: payment.type,
          amount: payment.amount,
          receivedOn: payment.receivedOn,
          note: request.reason,
          reversalRef: sql`nextval('booking_payment_reversal_ref_seq')`,
          reversalOfId: payment.id,
          reversalRequestId: request.id,
          recordedById: actor.id,
        })
        .returning({ id: bookingPayments.id, reversalRef: bookingPayments.reversalRef });
      reversalId = row.id;
      reversalRef = row.reversalRef;
    }
    await audit(
      tx,
      actor,
      approve ? (selfApproval ? "payment.reversal_approved_emergency" : "payment.reversal_approved") : "payment.reversal_rejected",
      "payment",
      payment.id,
      { requestId, status: "pending" },
      { requestId, status: approve ? "approved" : "rejected", note: note ?? null, reversalId, reversalRef, receiptNo: payment.receiptNo, amount: payment.amount },
    );
    return { status: approve ? ("approved" as const) : ("rejected" as const), reversalId, reversalRef };
  });
}

/** Receipt / reversal prefixes (super admin). The final format waits for the client (Q-F3). */
export async function updateFinanceSettings(db: Database, actor: Actor, input: unknown) {
  assertCanFinance(actor, "settings");
  const data = parse(financeSettingsSchema, input);
  return db.transaction(async (tx) => {
    const changed: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const [current] = await tx.select().from(financeSettings).where(eq(financeSettings.key, key));
      if ((current?.value ?? "") === value) continue;
      await tx
        .insert(financeSettings)
        .values({ key, value, updatedById: actor.id })
        .onConflictDoUpdate({ target: financeSettings.key, set: { value, updatedById: actor.id, updatedAt: new Date() } });
      await audit(tx, actor, "finance.setting", "finance_setting", key, { value: current?.value ?? "" }, { value });
      changed.push(key);
    }
    return { changed };
  });
}

/** Payment methods are configurable (proposed Q-F7 default); they are deactivated, never deleted. */
export async function addPaymentMethod(db: Database, actor: Actor, input: unknown) {
  assertCanFinance(actor, "settings");
  const { name } = parse(paymentMethodSchema, input);
  return db.transaction(async (tx) => {
    try {
      const [row] = await tx.transaction((sp) => sp.insert(paymentMethods).values({ name, sortOrder: 100 }).returning({ id: paymentMethods.id }));
      await audit(tx, actor, "finance.method_add", "payment_method", row.id, null, { name });
      return { methodId: row.id };
    } catch (error) {
      if (isUniqueViolation(error)) throw fieldError("name", "This method already exists");
      throw error;
    }
  });
}

export async function setPaymentMethodActive(db: Database, actor: Actor, methodId: string, active: boolean) {
  assertCanFinance(actor, "settings");
  if (!isId(methodId)) throw notFound("Payment method");
  return db.transaction(async (tx) => {
    const [method] = await tx.select().from(paymentMethods).where(eq(paymentMethods.id, methodId)).for("update");
    if (!method) throw notFound("Payment method");
    if (method.isActive === active) return { changed: false };
    await tx.update(paymentMethods).set({ isActive: active }).where(eq(paymentMethods.id, methodId));
    await audit(tx, actor, active ? "finance.method_activate" : "finance.method_deactivate", "payment_method", methodId, { isActive: method.isActive }, { isActive: active });
    return { changed: true };
  });
}
