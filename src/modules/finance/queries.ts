import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { bookingPayments, bookings, financeSettings, leads, paymentMethods, paymentReversalRequests, projects, units, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden, notFound } from "@/server/errors";
import { bookingScope, canAccessBooking } from "@/modules/bookings/policy";
import { teamMemberIds } from "@/modules/leads/support";
import { PAYMENT_PAGE_SIZE, PAYMENT_TYPES, SETTING_KEYS, type SettingKey } from "./constants";
import { canDoFinance, canSeeItemisedPayments } from "./policy";
import { z } from "zod";

export async function getFinanceSettings(db: Database): Promise<Record<SettingKey, string>> {
  const rows = await db.select().from(financeSettings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, map.get(k) ?? ""])) as Record<SettingKey, string>;
}

/** Display reference: configured prefix + number. No format is assumed beyond that (Q-F3 pending). */
export function formatReceipt(settings: Record<SettingKey, string>, row: { kind: string; receiptNo: number | null; reversalRef: number | null }) {
  return row.kind === "payment" ? `${settings.receipt_prefix}${row.receiptNo}` : `${settings.reversal_prefix}${row.reversalRef}`;
}

export async function listPaymentMethods(db: Database, opts: { activeOnly?: boolean } = {}) {
  return db
    .select({ id: paymentMethods.id, name: paymentMethods.name, isActive: paymentMethods.isActive })
    .from(paymentMethods)
    .where(opts.activeOnly ? eq(paymentMethods.isActive, true) : undefined)
    .orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.name));
}

const recorder = alias(users, "recorder");
const original = alias(bookingPayments, "original");

const paymentSelection = {
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
  originalReceiptNo: original.receiptNo,
  recordedAt: bookingPayments.recordedAt,
  recordedByName: recorder.name,
  leadName: leads.name,
  unitNo: units.unitNo,
  projectName: projects.name,
};

function baseQuery(db: Database) {
  return db
    .select(paymentSelection)
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .leftJoin(paymentMethods, eq(paymentMethods.id, bookingPayments.methodId))
    .leftJoin(original, eq(original.id, bookingPayments.reversalOfId))
    .leftJoin(recorder, eq(recorder.id, bookingPayments.recordedById));
}

async function withReferences<T extends { kind: string; receiptNo: number | null; reversalRef: number | null; originalReceiptNo: number | null }>(db: Database, rows: T[]) {
  const settings = await getFinanceSettings(db);
  return rows.map((r) => ({
    ...r,
    displayRef: formatReceipt(settings, r),
    originalReceipt: r.originalReceiptNo === null ? null : `${settings.receipt_prefix}${r.originalReceiptNo}`,
  }));
}

/**
 * Itemised payments of one booking (FR-204), oldest first, with each payment's reversal state and
 * any pending request. Finance roles see all bookings; managers only their team's (to approve reversals).
 */
export async function bookingPaymentHistory(db: Database, actor: Actor, bookingId: string) {
  if (!canSeeItemisedPayments(actor)) return null;
  const [booking] = await db.select({ agentId: bookings.agentId }).from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) throw notFound("Booking");
  // Out-of-scope bookings look missing, as everywhere else in the CRM.
  if (!canDoFinance(actor, "viewAll") && !canAccessBooking(actor, booking.agentId, await teamMemberIds(db, actor))) throw notFound("Booking");
  const rows = await withReferences(db, await baseQuery(db).where(eq(bookingPayments.bookingId, bookingId)).orderBy(asc(bookingPayments.recordedAt)));
  const requester = alias(users, "requester");
  const requests = await db
    .select({
      id: paymentReversalRequests.id,
      paymentId: paymentReversalRequests.paymentId,
      status: paymentReversalRequests.status,
      reason: paymentReversalRequests.reason,
      requestedByName: requester.name,
      createdAt: paymentReversalRequests.createdAt,
    })
    .from(paymentReversalRequests)
    .innerJoin(bookingPayments, eq(bookingPayments.id, paymentReversalRequests.paymentId))
    .leftJoin(requester, eq(requester.id, paymentReversalRequests.requestedById))
    .where(eq(bookingPayments.bookingId, bookingId))
    .orderBy(desc(paymentReversalRequests.createdAt));
  const reversedIds = new Set(rows.filter((r) => r.kind === "reversal").map((r) => r.reversalOfId));
  return rows.map((r) => ({
    ...r,
    reversed: r.kind === "payment" && reversedIds.has(r.id),
    pendingRequest: requests.find((q) => q.paymentId === r.id && q.status === "pending") ?? null,
  }));
}
export type PaymentHistoryRow = NonNullable<Awaited<ReturnType<typeof bookingPaymentHistory>>>[number];

const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  project: z.uuid().optional().catch(undefined),
  type: z.enum(PAYMENT_TYPES).optional().catch(undefined),
  kind: z.enum(["payment", "reversal"]).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  bookingId: z.uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/** Search by lead name / code, unit, payment reference, or receipt / reversal number (digits). */
function searchCondition(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const term = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const parts: SQL[] = [ilike(leads.name, term), ilike(leads.code, term), ilike(units.unitNo, term), ilike(bookingPayments.reference, term)];
  const digits = q.replace(/\D/g, "");
  if (digits && digits.length <= 9) parts.push(eq(bookingPayments.receiptNo, Number(digits)), eq(bookingPayments.reversalRef, Number(digits)));
  return or(...parts);
}

/** All payments and reversals (finance roles), newest first; each payment says whether it was reversed. */
export async function listPayments(db: Database, actor: Actor, rawQuery: unknown) {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  const q = listQuerySchema.parse(rawQuery ?? {});
  const where = and(
    q.type ? eq(bookingPayments.type, q.type) : undefined,
    q.kind ? eq(bookingPayments.kind, q.kind) : undefined,
    q.from ? gte(bookingPayments.receivedOn, q.from) : undefined,
    q.to ? lte(bookingPayments.receivedOn, q.to) : undefined,
    q.bookingId ? eq(bookingPayments.bookingId, q.bookingId) : undefined,
    q.project ? eq(bookings.projectId, q.project) : undefined,
    searchCondition(q.q),
  );
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(total / PAYMENT_PAGE_SIZE));
  const page = Math.min(q.page, pageCount);
  const rows = await baseQuery(db)
    .where(where)
    .orderBy(desc(bookingPayments.recordedAt))
    .limit(PAYMENT_PAGE_SIZE)
    .offset((page - 1) * PAYMENT_PAGE_SIZE);
  const ids = rows.filter((r) => r.kind === "payment").map((r) => r.id);
  const reversed = new Set(
    ids.length
      ? (
          await db
            .select({ id: bookingPayments.reversalOfId })
            .from(bookingPayments)
            .where(inArray(bookingPayments.reversalOfId, ids))
        ).map((r) => r.id)
      : [],
  );
  return {
    query: { ...q, page },
    total,
    page,
    pageCount,
    rows: (await withReferences(db, rows)).map((r) => ({ ...r, reversed: reversed.has(r.id) })),
  };
}
export type PaymentListRow = Awaited<ReturnType<typeof listPayments>>["rows"][number];

/** Reversal requests the actor may decide (managers: own team's bookings; admins and super admins: all). */
export async function reversalRequestsForActor(db: Database, actor: Actor, status: "pending" | "approved" | "rejected" = "pending") {
  if (!canDoFinance(actor, "decideReversal") && !canDoFinance(actor, "viewAll")) throw forbidden();
  const members = await teamMemberIds(db, actor);
  const scope: SQL | undefined =
    bookingScope(actor.role) === "team" ? inArray(bookings.agentId, [actor.id, ...members]) : bookingScope(actor.role) === "all" ? undefined : sql`false`;
  const requester = alias(users, "requester");
  return db
    .select({
      id: paymentReversalRequests.id,
      status: paymentReversalRequests.status,
      reason: paymentReversalRequests.reason,
      createdAt: paymentReversalRequests.createdAt,
      requestedById: paymentReversalRequests.requestedById,
      requestedByName: requester.name,
      paymentId: bookingPayments.id,
      receiptNo: bookingPayments.receiptNo,
      amount: bookingPayments.amount,
      bookingId: bookings.id,
      leadName: leads.name,
      unitNo: units.unitNo,
    })
    .from(paymentReversalRequests)
    .innerJoin(bookingPayments, eq(bookingPayments.id, paymentReversalRequests.paymentId))
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .leftJoin(requester, eq(requester.id, paymentReversalRequests.requestedById))
    .where(and(eq(paymentReversalRequests.status, status), scope))
    .orderBy(asc(paymentReversalRequests.createdAt));
}
