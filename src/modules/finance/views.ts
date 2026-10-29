import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database } from "@/server/db";
import { auditLogs, bookingPayments, bookings, leads, paymentMethods, paymentReversalRequests, projects, units, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden, notFound } from "@/server/errors";
import { MILESTONE_RATIO } from "@/modules/bookings/constants";
import { canAccessBooking } from "@/modules/bookings/policy";
import { teamMemberIds } from "@/modules/leads/support";
import { PAYABLE_STAGES } from "./constants";
import { netPaidByBooking, toPaisa } from "./ledger";
import { canDoFinance, canSeeItemisedPayments } from "./policy";
import { formatReceipt, getFinanceSettings } from "./queries";

const recorder = alias(users, "recorder");

/** One payment or reversal with its booking, related entries, requests and audit trail (F2 detail screen). */
export async function getPaymentDetail(db: Database, actor: Actor, paymentId: string) {
  if (!canSeeItemisedPayments(actor)) throw forbidden();
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) throw notFound("Payment");
  const select = {
    id: bookingPayments.id,
    bookingId: bookingPayments.bookingId,
    kind: bookingPayments.kind,
    type: bookingPayments.type,
    amount: bookingPayments.amount,
    receivedOn: bookingPayments.receivedOn,
    methodName: paymentMethods.name,
    reference: bookingPayments.reference,
    note: bookingPayments.note,
    receiptNo: bookingPayments.receiptNo,
    reversalRef: bookingPayments.reversalRef,
    reversalOfId: bookingPayments.reversalOfId,
    recordedAt: bookingPayments.recordedAt,
    recordedByName: recorder.name,
  };
  const load = (where: ReturnType<typeof eq>) =>
    db.select(select).from(bookingPayments).leftJoin(paymentMethods, eq(paymentMethods.id, bookingPayments.methodId)).leftJoin(recorder, eq(recorder.id, bookingPayments.recordedById)).where(where);

  const [row] = await load(eq(bookingPayments.id, paymentId));
  if (!row) throw notFound("Payment");
  const [booking] = await db
    .select({
      id: bookings.id,
      agentId: bookings.agentId,
      stage: bookings.stage,
      totalSale: bookings.totalSale,
      leadName: leads.name,
      leadCode: leads.code,
      unitNo: units.unitNo,
      projectName: projects.name,
    })
    .from(bookings)
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .where(eq(bookings.id, row.bookingId));
  // Managers see payments of their team's bookings only; elsewhere the payment looks missing.
  if (!canDoFinance(actor, "viewAll") && !canAccessBooking(actor, booking.agentId, await teamMemberIds(db, actor))) throw notFound("Payment");

  const originalId = row.kind === "payment" ? row.id : row.reversalOfId!;
  const [original] = row.kind === "payment" ? [row] : await load(eq(bookingPayments.id, originalId));
  const [reversal] = await load(eq(bookingPayments.reversalOfId, originalId));
  const settings = await getFinanceSettings(db);
  const label = (r: typeof row) => formatReceipt(settings, r);

  const requester = alias(users, "requester");
  const decider = alias(users, "decider");
  const requests = await db
    .select({
      id: paymentReversalRequests.id,
      status: paymentReversalRequests.status,
      reason: paymentReversalRequests.reason,
      createdAt: paymentReversalRequests.createdAt,
      requestedById: paymentReversalRequests.requestedById,
      requestedByName: requester.name,
      decidedByName: decider.name,
      decidedAt: paymentReversalRequests.decidedAt,
      decisionNote: paymentReversalRequests.decisionNote,
    })
    .from(paymentReversalRequests)
    .leftJoin(requester, eq(requester.id, paymentReversalRequests.requestedById))
    .leftJoin(decider, eq(decider.id, paymentReversalRequests.decidedById))
    .where(eq(paymentReversalRequests.paymentId, originalId))
    .orderBy(desc(paymentReversalRequests.createdAt));
  const auditActor = alias(users, "audit_actor");
  const trail = await db
    .select({ id: auditLogs.id, action: auditLogs.action, createdAt: auditLogs.createdAt, actorName: auditActor.name })
    .from(auditLogs)
    .leftJoin(auditActor, eq(auditActor.id, auditLogs.actorId))
    .where(and(eq(auditLogs.entity, "payment"), eq(auditLogs.entityId, originalId)))
    .orderBy(desc(auditLogs.createdAt));

  const pending = requests.find((r) => r.status === "pending") ?? null;
  return {
    entry: { ...row, label: label(row) },
    original: { ...original, label: label(original) },
    reversal: reversal ? { ...reversal, label: label(reversal) } : null,
    booking,
    requests,
    trail,
    pendingRequestId: pending?.id ?? null,
    permissions: {
      requestReversal: !reversal && !pending && canDoFinance(actor, "requestReversal"),
      decide: Boolean(pending) && canDoFinance(actor, "decideReversal") && (pending!.requestedById !== actor.id || actor.role === "super_admin"),
    },
  };
}
export type PaymentDetail = Awaited<ReturnType<typeof getPaymentDetail>>;

const outstandingQuerySchema = z.object({
  project: z.uuid().optional().catch(undefined),
  milestone: z.enum(["met", "not_met"]).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});

/**
 * FR-203 per-booking balances (all bookings except cancelled): total, paid (from rows), outstanding,
 * milestone. "Overdue vs schedule" needs installment schedules, which don't exist yet.
 */
export async function outstandingBookings(db: Database, actor: Actor, rawQuery: unknown) {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  const q = outstandingQuerySchema.parse(rawQuery ?? {});
  const agent = alias(users, "agent");
  const term = q.q ? `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = await db
    .select({
      bookingId: bookings.id,
      stage: bookings.stage,
      totalSale: bookings.totalSale,
      leadName: leads.name,
      leadCode: leads.code,
      unitNo: units.unitNo,
      projectName: projects.name,
      agentName: agent.name,
    })
    .from(bookings)
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .leftJoin(agent, eq(agent.id, bookings.agentId))
    .where(
      and(
        ne(bookings.stage, "cancelled"),
        q.project ? eq(bookings.projectId, q.project) : undefined,
        term ? or(ilike(leads.name, term), ilike(leads.code, term), ilike(units.unitNo, term)) : undefined,
      ),
    )
    .orderBy(asc(projects.name), asc(sql`lower(${units.unitNo})`));
  const paid = await netPaidByBooking(db, rows.map((r) => r.bookingId));
  const all = rows.map((r) => {
    const p = paid.get(r.bookingId) ?? 0;
    return { ...r, paid: p, outstanding: (toPaisa(r.totalSale) - toPaisa(p)) / 100, milestoneMet: toPaisa(p) >= toPaisa(r.totalSale * MILESTONE_RATIO) };
  });
  const rowsOut = q.milestone ? all.filter((r) => (q.milestone === "met" ? r.milestoneMet : !r.milestoneMet)) : all;
  const sum = (pick: (r: (typeof rowsOut)[number]) => number) => rowsOut.reduce((acc, r) => acc + toPaisa(pick(r)), 0) / 100;
  return { rows: rowsOut, totals: { total: sum((r) => r.totalSale), paid: sum((r) => r.paid), outstanding: sum((r) => r.outstanding) } };
}
export type OutstandingRow = Awaited<ReturnType<typeof outstandingBookings>>["rows"][number];

/** Bookings that can take a payment now (Token pending onward, not cancelled, balance left), for the record form. */
export async function payableBookings(db: Database, actor: Actor) {
  if (!canDoFinance(actor, "record")) throw forbidden();
  const rows = await db
    .select({
      id: bookings.id,
      totalSale: bookings.totalSale,
      stage: bookings.stage,
      leadName: leads.name,
      leadCode: leads.code,
      unitNo: units.unitNo,
      projectName: projects.name,
    })
    .from(bookings)
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .where(inArray(bookings.stage, [...PAYABLE_STAGES]))
    .orderBy(asc(projects.name), asc(leads.name));
  const paid = await netPaidByBooking(db, rows.map((r) => r.id));
  return rows
    .map((r) => {
      const p = paid.get(r.id) ?? 0;
      return { ...r, paid: p, outstanding: (toPaisa(r.totalSale) - toPaisa(p)) / 100 };
    })
    .filter((r) => r.outstanding > 0);
}
export type PayableBooking = Awaited<ReturnType<typeof payableBookings>>[number];
