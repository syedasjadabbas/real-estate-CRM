import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db";
import { auditLogs, bookingPayments, bookings, leads, paymentMethods, projects, units } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { businessToday } from "@/modules/bookings/today";
import { parse } from "@/modules/clients/support";
import { bookingRef, REFUND_PREFIX } from "./constants";
import { toPaisa } from "./ledger";
import { assertCanFinance, canDoFinance } from "./policy";

/**
 * Refunds on cancelled bookings (client rule: "refund after a variable deduction"; owner, 19 Nov 2026).
 * An Admin cancels a paid booking and enters the deduction kept, which sets the booking's refund due.
 * Accounts (or a Super Admin) then records what is actually paid back, in one or more refunds, each a
 * `refund` row in the payment ledger with its own RF- reference. Refunds lower the booking's net paid,
 * count on the day they are paid (the period processed) and never exceed the refund due.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const refundSchema = z.object({
  amount: z.coerce.number("Enter the amount refunded").positive("Enter the amount refunded").max(1e12),
  paidOn: z.string("Enter the date it was paid").regex(DATE, "Enter the date it was paid"),
  methodId: z.uuid("Choose how it was paid"),
  reference: z.string().trim().max(120, "Use at most 120 characters").optional().transform((v) => v || null),
  note: z.string().trim().max(1000).optional().transform((v) => v || null),
});

const fieldError = (field: string, message: string) => new AppError("VALIDATION_FAILED", message, { fields: { [field]: message } });
const pkr = (n: number) => `PKR ${new Intl.NumberFormat("en-US").format(n)}`;

/** Cancelled bookings with a refund due, with what has been refunded and what is left (oldest first). */
export async function refundsDue(db: Database, actor: Actor, { open = true }: { open?: boolean } = {}) {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  const refunded = sql<string>`(select coalesce(sum(p.amount), 0) from booking_payments p where p.booking_id = ${bookings.id} and p.kind::text = 'refund')`;
  const rows = await db
    .select({
      bookingId: bookings.id,
      refNo: bookings.refNo,
      leadName: leads.name,
      unitNo: units.unitNo,
      projectName: projects.name,
      cancelledAt: bookings.cancelledAt,
      cancelledReason: bookings.cancelledReason,
      deduction: bookings.refundDeduction,
      due: bookings.refundDue,
      refunded,
    })
    .from(bookings)
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .where(and(eq(bookings.stage, "cancelled"), isNotNull(bookings.refundDue)))
    .orderBy(asc(bookings.cancelledAt));
  const prefixRow = await db.execute<{ value: string }>(sql`select value from finance_settings where key = 'booking_prefix'`);
  const prefix = prefixRow.rows[0]?.value ?? "";
  const out = rows.map((r) => {
    const due = Number(r.due ?? 0);
    const paid = Number(r.refunded);
    return { ...r, ref: bookingRef(prefix, r.refNo), deduction: Number(r.deduction ?? 0), due, refunded: paid, remaining: (toPaisa(due) - toPaisa(paid)) / 100 };
  });
  return open ? out.filter((r) => r.remaining > 0) : out;
}
export type RefundDueRow = Awaited<ReturnType<typeof refundsDue>>[number];

/** Accounts records money paid back to the buyer of a cancelled booking (up to what is still due). */
export async function recordRefund(db: Database, actor: Actor & { ip?: string | null }, bookingId: string, input: unknown) {
  assertCanFinance(actor, "record");
  const data = parse(refundSchema, input);
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) throw notFound("Booking");
  if (data.paidOn > businessToday()) throw fieldError("paidOn", "The date can't be in the future");
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
    if (!booking) throw notFound("Booking");
    if (booking.stage !== "cancelled" || booking.refundDue === null) throw new AppError("BUSINESS_RULE", "Only a cancelled booking with a refund due can be refunded.");
    const [{ refunded }] = await tx
      .select({ refunded: sql<string>`coalesce(sum(${bookingPayments.amount}), 0)` })
      .from(bookingPayments)
      .where(and(eq(bookingPayments.bookingId, bookingId), sql`${bookingPayments.kind}::text = 'refund'`));
    const remaining = (toPaisa(Number(booking.refundDue)) - toPaisa(Number(refunded))) / 100;
    if (remaining <= 0) throw new AppError("BUSINESS_RULE", "This refund has already been paid in full.");
    if (toPaisa(data.amount) > toPaisa(remaining)) throw fieldError("amount", `At most ${pkr(remaining)} is still due`);
    const [method] = await tx.select({ id: paymentMethods.id, isActive: paymentMethods.isActive }).from(paymentMethods).where(eq(paymentMethods.id, data.methodId));
    if (!method?.isActive) throw fieldError("methodId", "Choose an active payment method");
    const [row] = await tx
      .insert(bookingPayments)
      .values({
        bookingId,
        kind: "refund",
        type: "other",
        amount: data.amount,
        receivedOn: data.paidOn,
        methodId: data.methodId,
        reference: data.reference,
        note: data.note,
        refundRef: sql`nextval('booking_payment_refund_ref_seq')`,
        recordedById: actor.id,
      })
      .returning({ id: bookingPayments.id, refundRef: bookingPayments.refundRef });
    await tx.insert(auditLogs).values({
      actorId: actor.id,
      ip: actor.ip ?? null,
      action: "payment.refund",
      entity: "booking",
      entityId: bookingId,
      before: { refunded: Number(refunded) },
      after: { refundId: row.id, ref: `${REFUND_PREFIX}${row.refundRef}`, amount: data.amount, paidOn: data.paidOn, remaining: (toPaisa(remaining) - toPaisa(data.amount)) / 100 },
    });
    return { refundId: row.id, ref: `${REFUND_PREFIX}${row.refundRef}`, remaining: (toPaisa(remaining) - toPaisa(data.amount)) / 100 };
  });
}
