import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database } from "@/server/db";
import { auditLogs, bookingPayments, bookings, developerTransferReceipts, developerTransfers, holidays, leads, projects, units, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden } from "@/server/errors";
import { getAttendanceSettings } from "@/modules/attendance/service";
import { businessToday } from "@/modules/bookings/today";
import { parse } from "@/modules/clients/support";
import { getFinanceSettings, receiptLabel } from "./queries";
import { toPaisa } from "./ledger";
import { assertCanFinance, canDoFinance } from "./policy";

/**
 * Transfers to the developer (client rule: collections are passed on within 10 working days; owner,
 * 19 Nov 2026). Every posted receipt that hasn't been reversed is due to the developer 10 working days
 * after it was received; working days skip the weekly days off (HR settings) and company holidays.
 * Accounts records a transfer and ticks the receipts it covers; the tracker shows what is pending,
 * due soon or overdue, and whether each transfer was on time.
 */
export const TRANSFER_WORKING_DAYS = 10;
/** "Due soon" when this many working days or fewer are left. */
export const DUE_SOON_WORKING_DAYS = 2;

/** The day `n` working days after `from` (weekly days off and company holidays skipped). */
export function addWorkingDays(from: string, n: number, weekendDays: number[], holidayDates: Set<string>) {
  const d = new Date(`${from}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.toISOString().slice(0, 10);
    if (weekendDays.includes(d.getUTCDay()) || holidayDates.has(day)) continue;
    left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/** Working days from `from` (exclusive) to `to` (inclusive); negative when `to` is earlier. */
export function workingDaysBetween(from: string, to: string, weekendDays: number[], holidayDates: Set<string>) {
  if (from === to) return 0;
  const sign = to > from ? 1 : -1;
  const [a, b] = sign > 0 ? [from, to] : [to, from];
  const d = new Date(`${a}T00:00:00Z`);
  let n = 0;
  while (d.toISOString().slice(0, 10) < b) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.toISOString().slice(0, 10);
    if (!weekendDays.includes(d.getUTCDay()) && !holidayDates.has(day)) n += 1;
  }
  return n * sign;
}

async function calendar(db: Database, from: string, to: string) {
  const settings = await getAttendanceSettings(db);
  const hol = await db.select({ date: holidays.date }).from(holidays).where(and(eq(holidays.scope, "company"), gte(holidays.date, from), lte(holidays.date, to)));
  return { weekendDays: settings.weekendDays, holidayDates: new Set(hol.map((h) => h.date)) };
}

const pendingWhere = and(
  eq(bookingPayments.kind, "payment"),
  sql`not exists (select 1 from developer_transfer_receipts d where d.payment_id = ${bookingPayments.id})`,
  // A reversed receipt isn't money held any more.
  sql`not exists (select 1 from booking_payments r where r.reversal_of_id = ${bookingPayments.id})`,
);

/** Receipts not yet passed to the developer, oldest first, with their deadline and status. */
export async function pendingTransfers(db: Database, actor: Actor, today = businessToday()) {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  const rows = await db
    .select({
      id: bookingPayments.id,
      receiptNo: bookingPayments.receiptNo,
      receivedOn: bookingPayments.receivedOn,
      amount: bookingPayments.amount,
      leadName: leads.name,
      unitNo: units.unitNo,
      floor: units.floor,
      projectName: projects.name,
    })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .where(pendingWhere)
    .orderBy(asc(bookingPayments.receivedOn), asc(bookingPayments.receiptNo));
  if (rows.length === 0) return { rows: [], totals: { count: 0, amount: 0, overdue: 0, overdueAmount: 0, dueSoon: 0 } };
  const first = rows[0].receivedOn;
  const cal = await calendar(db, first, `${Number(today.slice(0, 4)) + 1}-12-31`);
  const settings = await getFinanceSettings(db);
  const out = rows.map((r) => {
    const dueOn = addWorkingDays(r.receivedOn, TRANSFER_WORKING_DAYS, cal.weekendDays, cal.holidayDates);
    const left = workingDaysBetween(today, dueOn, cal.weekendDays, cal.holidayDates);
    const status = dueOn < today ? ("overdue" as const) : left <= DUE_SOON_WORKING_DAYS ? ("due_soon" as const) : ("pending" as const);
    return { ...r, receipt: receiptLabel(settings.receipt_prefix, r.floor, r.receiptNo), dueOn, workingDaysLeft: left, status };
  });
  const sum = (list: typeof out) => list.reduce((n, r) => n + toPaisa(r.amount), 0) / 100;
  const overdue = out.filter((r) => r.status === "overdue");
  return { rows: out, totals: { count: out.length, amount: sum(out), overdue: overdue.length, overdueAmount: sum(overdue), dueSoon: out.filter((r) => r.status === "due_soon").length } };
}
export type PendingTransferRow = Awaited<ReturnType<typeof pendingTransfers>>["rows"][number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const transferSchema = z.object({
  transferredOn: z.string("Enter the transfer date").regex(DATE, "Enter the transfer date"),
  reference: z.string().trim().max(120, "Use at most 120 characters").optional().transform((v) => v || null),
  note: z.string().trim().max(1000).optional().transform((v) => v || null),
  paymentIds: z.array(z.uuid()).min(1, "Tick the receipts this transfer covers").max(500),
});

/** Accounts records one transfer to the developer covering the ticked receipts. */
export async function recordTransfer(db: Database, actor: Actor & { ip?: string | null }, input: unknown) {
  assertCanFinance(actor, "record");
  const data = parse(transferSchema, input);
  if (data.transferredOn > businessToday()) throw new AppError("VALIDATION_FAILED", "The date can't be in the future", { fields: { transferredOn: "The date can't be in the future" } });
  const ids = [...new Set(data.paymentIds)];
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: bookingPayments.id, amount: bookingPayments.amount, receivedOn: bookingPayments.receivedOn })
      .from(bookingPayments)
      .where(and(inArray(bookingPayments.id, ids), pendingWhere))
      .for("update");
    if (rows.length !== ids.length) throw new AppError("CONFLICT", "Some of these receipts were already transferred or reversed. Reload the list and try again.");
    if (rows.some((r) => r.receivedOn > data.transferredOn)) {
      throw new AppError("VALIDATION_FAILED", "A receipt can't be transferred before it was received.", { fields: { transferredOn: "On or after the latest receipt date" } });
    }
    const amount = rows.reduce((n, r) => n + toPaisa(r.amount), 0) / 100;
    const [transfer] = await tx
      .insert(developerTransfers)
      .values({ transferredOn: data.transferredOn, amount, reference: data.reference, note: data.note, recordedById: actor.id })
      .returning({ id: developerTransfers.id });
    // The primary key on payment_id also stops a receipt being transferred twice by a concurrent request.
    await tx.insert(developerTransferReceipts).values(ids.map((paymentId) => ({ transferId: transfer.id, paymentId })));
    await tx.insert(auditLogs).values({
      actorId: actor.id,
      ip: actor.ip ?? null,
      action: "finance.developer_transfer",
      entity: "developer_transfer",
      entityId: transfer.id,
      before: null,
      after: { transferredOn: data.transferredOn, amount, receipts: ids.length, reference: data.reference },
    });
    return { transferId: transfer.id, amount, receipts: ids.length };
  });
}

const recorder = alias(users, "transfer_recorder");

/** Transfers made, newest first, each with its receipts and whether all of them went on time. */
export async function transferHistory(db: Database, actor: Actor, limit = 100) {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  const transfers = await db
    .select({ id: developerTransfers.id, transferredOn: developerTransfers.transferredOn, amount: developerTransfers.amount, reference: developerTransfers.reference, note: developerTransfers.note, recordedBy: recorder.name, createdAt: developerTransfers.createdAt })
    .from(developerTransfers)
    .leftJoin(recorder, eq(recorder.id, developerTransfers.recordedById))
    .orderBy(desc(developerTransfers.transferredOn), desc(developerTransfers.createdAt))
    .limit(limit);
  if (transfers.length === 0) return [];
  const receipts = await db
    .select({ transferId: developerTransferReceipts.transferId, receivedOn: bookingPayments.receivedOn })
    .from(developerTransferReceipts)
    .innerJoin(bookingPayments, eq(bookingPayments.id, developerTransferReceipts.paymentId))
    .where(inArray(developerTransferReceipts.transferId, transfers.map((t) => t.id)));
  const earliest = receipts.reduce((m, r) => (r.receivedOn < m ? r.receivedOn : m), transfers[transfers.length - 1].transferredOn);
  const cal = await calendar(db, earliest, transfers[0].transferredOn);
  return transfers.map((t) => {
    const mine = receipts.filter((r) => r.transferId === t.id);
    const late = mine.filter((r) => addWorkingDays(r.receivedOn, TRANSFER_WORKING_DAYS, cal.weekendDays, cal.holidayDates) < t.transferredOn).length;
    return { ...t, receipts: mine.length, late, onTime: late === 0 };
  });
}
export type TransferHistoryRow = Awaited<ReturnType<typeof transferHistory>>[number];
