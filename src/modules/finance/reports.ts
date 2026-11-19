import { and, asc, desc, gte, isNull, lte, sql, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { incomeExpenseByMonth } from "./entries";
import type { Database } from "@/server/db";
import { auditLogs, bookingPayments, bookings, financeCategories, financeEntries, leads, paymentMethods, projects, units, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden } from "@/server/errors";
import { businessToday } from "@/modules/bookings/today";
import { toPaisa } from "./ledger";
import { canDoFinance } from "./policy";
import { AGING_BUCKETS, PAYMENT_KIND_LABELS, type AgingBucket } from "./constants";
import { formatReceipt, getFinanceSettings } from "./queries";
import { outstandingBookings } from "./views";

/**
 * FR-205 reports with confirmed definitions only (FINANCE_MODULE_PLAN.md §4, F4):
 * - Collections by project: ledger rows dated in the range, by the booking's project. Each row is
 *   counted on its own date: payments add, reversals subtract (the ledger's net rule).
 * - Outstanding by project / agent: the FR-203 balances (total − net paid, cancelled bookings
 *   excluded), grouped. Totals equal the Outstanding screen.
 * - Daily collections (client list, 10 Nov 2026): the same ledger rows by day, project, unit and agent.
 * - Refunds & reversals: every reversal and refund dated in the range, with its reference.
 * - Commissions (owner, 19 Nov 2026): from recorded entries only. Received = income in the
 *   "Commission" category; paid to agents = expenses in "Agent commissions", by month and payee.
 * - Income vs expense by month (finance entries; booking collections are kept apart, client rule).
 * Read: super admin, admin, accountant (matrix "Reports + CSV export").
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const reportQuerySchema = z.object({
  from: z.string().regex(DATE).optional().catch(undefined),
  to: z.string().regex(DATE).optional().catch(undefined),
});

/** Range defaults to month to date (Pakistan time); a reversed range is swapped. */
export function reportRange(input: unknown, today = businessToday()) {
  const q = reportQuerySchema.parse(input ?? {});
  let from = q.from ?? `${today.slice(0, 7)}-01`;
  let to = q.to ?? today;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

const money = (paisa: number) => paisa / 100;

export async function collectionsByProject(db: Database, actor: Actor, input: unknown = {}) {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  const range = reportRange(input);
  const rows = await db
    .select({
      projectId: projects.id,
      project: projects.name,
      received: sql<string>`coalesce(sum(case when ${bookingPayments.kind} = 'payment' then ${bookingPayments.amount} else 0 end), 0)`,
      reversed: sql<string>`coalesce(sum(case when ${bookingPayments.kind}::text = 'reversal' then ${bookingPayments.amount} else 0 end), 0)`,
      refunded: sql<string>`coalesce(sum(case when ${bookingPayments.kind}::text = 'refund' then ${bookingPayments.amount} else 0 end), 0)`,
      receipts: sql<number>`count(*) filter (where ${bookingPayments.kind} = 'payment')::int`,
      reversals: sql<number>`count(*) filter (where ${bookingPayments.kind}::text = 'reversal')::int`,
      refunds: sql<number>`count(*) filter (where ${bookingPayments.kind}::text = 'refund')::int`,
    })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .where(and(gte(bookingPayments.receivedOn, range.from), lte(bookingPayments.receivedOn, range.to)))
    .groupBy(projects.id, projects.name)
    .orderBy(asc(projects.name));
  const out = rows.map((r) => {
    const received = toPaisa(Number(r.received));
    const reversed = toPaisa(Number(r.reversed));
    const refunded = toPaisa(Number(r.refunded));
    return {
      projectId: r.projectId,
      project: r.project,
      receipts: r.receipts,
      reversals: r.reversals,
      refunds: r.refunds,
      received: money(received),
      reversed: money(reversed),
      refunded: money(refunded),
      net: money(received - reversed - refunded),
    };
  });
  const sum = (k: "received" | "reversed" | "refunded" | "net") => money(out.reduce((n, r) => n + toPaisa(r[k]), 0));
  return {
    range,
    rows: out,
    totals: {
      received: sum("received"),
      reversed: sum("reversed"),
      refunded: sum("refunded"),
      net: sum("net"),
      receipts: out.reduce((n, r) => n + r.receipts, 0),
      reversals: out.reduce((n, r) => n + r.reversals, 0),
      refunds: out.reduce((n, r) => n + r.refunds, 0),
    },
  };
}

const agentUser = alias(users, "report_agent");

/** Daily collections by project, unit and agent: each ledger row counts on its own date (net rule). */
export async function dailyCollections(db: Database, actor: Actor, input: unknown = {}) {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  const range = reportRange(input);
  const rows = await db
    .select({
      day: bookingPayments.receivedOn,
      project: projects.name,
      unitNo: units.unitNo,
      agentId: bookings.agentId,
      agent: agentUser.name,
      received: sql<string>`coalesce(sum(${bookingPayments.amount}) filter (where ${bookingPayments.kind} = 'payment'), 0)`,
      out: sql<string>`coalesce(sum(${bookingPayments.amount}) filter (where ${bookingPayments.kind} <> 'payment'), 0)`,
      entries: sql<number>`count(*)::int`,
    })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .leftJoin(agentUser, eq(agentUser.id, bookings.agentId))
    .where(and(gte(bookingPayments.receivedOn, range.from), lte(bookingPayments.receivedOn, range.to)))
    .groupBy(bookingPayments.receivedOn, projects.name, units.unitNo, bookings.agentId, agentUser.name)
    .orderBy(desc(bookingPayments.receivedOn), asc(projects.name), asc(units.unitNo));
  const out = rows.map((r) => {
    const received = toPaisa(Number(r.received));
    const back = toPaisa(Number(r.out));
    return { day: r.day, project: r.project, unitNo: r.unitNo, agent: r.agent ?? "No agent", entries: r.entries, received: money(received), returned: money(back), net: money(received - back) };
  });
  const days = new Map<string, number>();
  for (const r of out) days.set(r.day, (days.get(r.day) ?? 0) + toPaisa(r.net));
  return {
    range,
    rows: out,
    days: [...days.entries()].map(([day, net]) => ({ day, net: money(net) })),
    totals: { received: money(out.reduce((n, r) => n + toPaisa(r.received), 0)), returned: money(out.reduce((n, r) => n + toPaisa(r.returned), 0)), net: money(out.reduce((n, r) => n + toPaisa(r.net), 0)) },
  };
}

const originalPayment = alias(bookingPayments, "report_original");
const recordedBy = alias(users, "report_recorder");

/** Every reversal and refund dated in the range (the period it was processed), newest first. */
export async function refundsAndReversals(db: Database, actor: Actor, input: unknown = {}) {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  const range = reportRange(input);
  const settings = await getFinanceSettings(db);
  const rows = await db
    .select({
      id: bookingPayments.id,
      kind: bookingPayments.kind,
      date: bookingPayments.receivedOn,
      amount: bookingPayments.amount,
      reversalRef: bookingPayments.reversalRef,
      refundRef: bookingPayments.refundRef,
      receiptNo: bookingPayments.receiptNo,
      originalReceiptNo: originalPayment.receiptNo,
      floor: units.floor,
      reference: bookingPayments.reference,
      note: bookingPayments.note,
      method: paymentMethods.name,
      leadName: leads.name,
      project: projects.name,
      unitNo: units.unitNo,
      recordedBy: recordedBy.name,
    })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .leftJoin(originalPayment, eq(originalPayment.id, bookingPayments.reversalOfId))
    .leftJoin(paymentMethods, eq(paymentMethods.id, bookingPayments.methodId))
    .leftJoin(recordedBy, eq(recordedBy.id, bookingPayments.recordedById))
    .where(and(sql`${bookingPayments.kind} <> 'payment'`, gte(bookingPayments.receivedOn, range.from), lte(bookingPayments.receivedOn, range.to)))
    .orderBy(desc(bookingPayments.receivedOn), desc(bookingPayments.recordedAt));
  const out = rows.map((r) => ({
    ...r,
    kindLabel: PAYMENT_KIND_LABELS[r.kind],
    ref: formatReceipt(settings, r),
    ofReceipt: r.kind === "reversal" && r.originalReceiptNo !== null ? formatReceipt(settings, { kind: "payment", receiptNo: r.originalReceiptNo, reversalRef: null, floor: r.floor }) : null,
  }));
  const total = (k: "reversal" | "refund") => money(out.filter((r) => r.kind === k).reduce((n, r) => n + toPaisa(r.amount), 0));
  return { range, rows: out, totals: { reversals: out.filter((r) => r.kind === "reversal").length, reversed: total("reversal"), refunds: out.filter((r) => r.kind === "refund").length, refunded: total("refund") } };
}

/** Category names the commission report reads (seeded by migration 0057). */
export const COMMISSION_INCOME_CATEGORY = "Commission";
export const AGENT_COMMISSION_CATEGORY = "Agent commissions";

/** Commission received and agent commissions paid in a year, from recorded entries (not computed). */
export async function commissionReport(db: Database, actor: Actor, input: unknown = {}) {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  const thisYear = Number(businessToday().slice(0, 4));
  const year = z.coerce.number().int().min(2000).max(2100).catch(thisYear).parse((input as Record<string, unknown>)?.year ?? thisYear);
  const live = and(isNull(financeEntries.voidedAt), sql`extract(year from ${financeEntries.entryDate}) = ${year}`);
  const byMonth = await db
    .select({
      month: sql<number>`extract(month from ${financeEntries.entryDate})::int`,
      received: sql<string>`coalesce(sum(${financeEntries.amount}) filter (where ${financeEntries.kind} = 'income' and ${financeCategories.name} = ${COMMISSION_INCOME_CATEGORY}), 0)`,
      paid: sql<string>`coalesce(sum(${financeEntries.amount}) filter (where ${financeEntries.kind} = 'expense' and ${financeCategories.name} = ${AGENT_COMMISSION_CATEGORY}), 0)`,
    })
    .from(financeEntries)
    .innerJoin(financeCategories, eq(financeCategories.id, financeEntries.categoryId))
    .where(live)
    .groupBy(sql`1`);
  const months = Array.from({ length: 12 }, (_, i) => {
    const r = byMonth.find((x) => x.month === i + 1);
    const received = toPaisa(Number(r?.received ?? 0));
    const paid = toPaisa(Number(r?.paid ?? 0));
    return { month: `${year}-${String(i + 1).padStart(2, "0")}`, received: money(received), paid: money(paid), net: money(received - paid) };
  });
  const payees = await db
    .select({
      payee: sql<string>`coalesce(nullif(trim(${financeEntries.payee}), ''), 'No payee')`,
      entries: sql<number>`count(*)::int`,
      paid: sql<string>`sum(${financeEntries.amount})`,
    })
    .from(financeEntries)
    .innerJoin(financeCategories, eq(financeCategories.id, financeEntries.categoryId))
    .where(and(live, eq(financeEntries.kind, "expense"), eq(financeCategories.name, AGENT_COMMISSION_CATEGORY)))
    .groupBy(sql`1`)
    .orderBy(sql`3 desc`);
  const sum = (k: "received" | "paid" | "net") => money(months.reduce((n, m) => n + toPaisa(m[k]), 0));
  return { year, months, payees: payees.map((p) => ({ payee: p.payee, entries: p.entries, paid: Number(p.paid) })), totals: { received: sum("received"), paid: sum("paid"), net: sum("net") } };
}

export async function outstandingBy(db: Database, actor: Actor, by: "project" | "agent") {
  const { rows, totals } = await outstandingBookings(db, actor, {});
  // Overdue is split by the aging of each booking's oldest overdue amount (client buckets, 10 Nov 2026).
  type Group = { key: string; label: string; bookings: number; total: number; paid: number; outstanding: number; overdue: number; aging: Record<AgingBucket, number> };
  const groups = new Map<string, Group>();
  const noAging = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0])) as Record<AgingBucket, number>;
  for (const r of rows) {
    const label = by === "project" ? r.projectName : r.agentName ?? "No agent";
    // Agents group by id: two people can share a name. Project names are unique.
    const key = by === "project" ? label : (r.agentId ?? "none");
    const g = groups.get(key) ?? { key, label, bookings: 0, total: 0, paid: 0, outstanding: 0, overdue: 0, aging: noAging() };
    g.bookings += 1;
    g.total += toPaisa(r.totalSale);
    g.paid += toPaisa(r.paid);
    g.outstanding += toPaisa(r.outstanding);
    g.overdue += toPaisa(r.overdue ?? 0);
    if (r.aging) g.aging[r.aging] += toPaisa(r.overdue ?? 0);
    groups.set(key, g);
  }
  const out = [...groups.values()]
    .map((g) => ({
      ...g,
      total: money(g.total),
      paid: money(g.paid),
      outstanding: money(g.outstanding),
      overdue: money(g.overdue),
      aging: Object.fromEntries(Object.entries(g.aging).map(([k, v]) => [k, money(v)])) as Record<AgingBucket, number>,
    }))
    .sort((a, b) => b.outstanding - a.outstanding || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  return { by, rows: out, totals: { ...totals, bookings: rows.length } };
}

export const REPORT_KINDS = ["collections", "daily_collections", "outstanding_project", "outstanding_agent", "income_expense", "refunds_reversals", "commissions"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const esc = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  // Quote separators and neutralise spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (header: string[], lines: (string | number | null)[][]) => [header.join(","), ...lines.map((l) => l.map(esc).join(","))].join("\n") + "\n";

/** CSV for a report (FR-205), audited as `finance.report_export` with the totals exported. */
export async function exportReport(db: Database, actor: Actor, input: Record<string, unknown>) {
  // A name we don't know is refused: quietly exporting another report would hand over the wrong figures (F-11).
  const report = z.enum(REPORT_KINDS).default("collections").safeParse(input.report);
  if (!report.success) throw new AppError("VALIDATION_FAILED", "Unknown report.", { fields: { report: "Choose a report from the list" } });
  const kind = report.data;
  let body: string;
  let filename: string;
  let summary: Record<string, unknown>;
  if (kind === "daily_collections") {
    const r = await dailyCollections(db, actor, input);
    body = csv(
      ["Date", "Project", "Unit", "Agent", "Entries", "Received (PKR)", "Reversed / refunded (PKR)", "Net (PKR)"],
      [...r.rows.map((x) => [x.day, x.project, x.unitNo, x.agent, x.entries, x.received, x.returned, x.net]), ["Total", "", "", "", "", r.totals.received, r.totals.returned, r.totals.net]],
    );
    filename = `daily-collections-${r.range.from}-to-${r.range.to}.csv`;
    summary = { range: r.range, totals: r.totals };
  } else if (kind === "refunds_reversals") {
    const r = await refundsAndReversals(db, actor, input);
    body = csv(
      ["Date", "Type", "Reference", "Of receipt", "Buyer", "Project", "Unit", "Amount (PKR)", "Method", "Bank / cheque ref", "Note", "Recorded by"],
      r.rows.map((x) => [x.date, x.kindLabel, x.ref, x.ofReceipt, x.leadName, x.project, x.unitNo, x.amount, x.method, x.reference, x.note, x.recordedBy]),
    );
    filename = `refunds-reversals-${r.range.from}-to-${r.range.to}.csv`;
    summary = { range: r.range, totals: r.totals };
  } else if (kind === "commissions") {
    const r = await commissionReport(db, actor, input);
    body = csv(
      ["Month", "Commission received (PKR)", "Agent commissions paid (PKR)", "Net (PKR)"],
      [...r.months.map((m) => [m.month, m.received, m.paid, m.net]), ["Total", r.totals.received, r.totals.paid, r.totals.net], [], ["Payee", "Entries", "Paid (PKR)"], ...r.payees.map((p) => [p.payee, p.entries, p.paid])],
    );
    filename = `commissions-${r.year}.csv`;
    summary = { year: r.year, totals: r.totals };
  } else if (kind === "income_expense") {
    const r = await incomeExpenseByMonth(db, actor, input);
    body = csv(
      ["Month", "Income (PKR)", "Expense (PKR)", "Net (PKR)"],
      [...r.months.map((m) => [m.month, m.income, m.expense, m.net]), ["Total", r.totals.income, r.totals.expense, r.totals.net]],
    );
    filename = `income-vs-expense-${r.year}.csv`;
    summary = { year: r.year, totals: r.totals };
  } else if (kind === "collections") {
    const r = await collectionsByProject(db, actor, input);
    body = csv(
      ["Project", "From", "To", "Receipts", "Received (PKR)", "Reversals", "Reversed (PKR)", "Refunds", "Refunded (PKR)", "Net collected (PKR)"],
      [
        ...r.rows.map((x) => [x.project, r.range.from, r.range.to, x.receipts, x.received, x.reversals, x.reversed, x.refunds, x.refunded, x.net]),
        ["Total", r.range.from, r.range.to, r.totals.receipts, r.totals.received, r.totals.reversals, r.totals.reversed, r.totals.refunds, r.totals.refunded, r.totals.net],
      ],
    );
    filename = `collections-${r.range.from}-to-${r.range.to}.csv`;
    summary = { range: r.range, totals: r.totals };
  } else {
    const by = kind === "outstanding_project" ? "project" : "agent";
    const r = await outstandingBy(db, actor, by);
    const today = businessToday();
    body = csv(
      [by === "project" ? "Project" : "Agent", "As of", "Bookings", "Total sale (PKR)", "Paid (PKR)", "Outstanding (PKR)", "Overdue (PKR)", ...AGING_BUCKETS.map((b) => `Overdue ${b.label} (PKR)`)],
      [
        ...r.rows.map((x) => [x.label, today, x.bookings, x.total, x.paid, x.outstanding, x.overdue, ...AGING_BUCKETS.map((b) => x.aging[b.key])]),
        ["Total", today, r.totals.bookings, r.totals.total, r.totals.paid, r.totals.outstanding, r.totals.overdue, ...AGING_BUCKETS.map((b) => money(r.rows.reduce((n, x) => n + toPaisa(x.aging[b.key]), 0)))],
      ],
    );
    filename = `outstanding-by-${by}-${today}.csv`;
    summary = { asOf: today, totals: r.totals };
  }
  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "finance.report_export", entity: "finance_report", entityId: kind, after: summary });
  return { body, filename };
}
