import { and, asc, gte, lte, sql, eq } from "drizzle-orm";
import { z } from "zod";
import { incomeExpenseByMonth } from "./entries";
import type { Database } from "@/server/db";
import { auditLogs, bookingPayments, bookings, projects } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { businessToday } from "@/modules/bookings/today";
import { toPaisa } from "./ledger";
import { canDoFinance } from "./policy";
import { outstandingBookings } from "./views";

/**
 * FR-205 reports with confirmed definitions only (FINANCE_MODULE_PLAN.md §4, F4):
 * - Collections by project: ledger rows dated in the range, by the booking's project. Each row is
 *   counted on its own date: payments add, reversals subtract (the ledger's net rule).
 * - Outstanding by project / agent: the FR-203 balances (total − net paid, cancelled bookings
 *   excluded), grouped. Totals equal the Outstanding screen.
 * Income vs expense waits for F3 (Q-F4, Q-F9); overdue vs schedule for Q-B6.
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
      reversed: sql<string>`coalesce(sum(case when ${bookingPayments.kind} = 'payment' then 0 else ${bookingPayments.amount} end), 0)`,
      receipts: sql<number>`count(*) filter (where ${bookingPayments.kind} = 'payment')::int`,
      reversals: sql<number>`count(*) filter (where ${bookingPayments.kind} <> 'payment')::int`,
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
    return { projectId: r.projectId, project: r.project, receipts: r.receipts, reversals: r.reversals, received: money(received), reversed: money(reversed), net: money(received - reversed) };
  });
  const sum = (k: "received" | "reversed" | "net") => money(out.reduce((n, r) => n + toPaisa(r[k]), 0));
  return {
    range,
    rows: out,
    totals: { received: sum("received"), reversed: sum("reversed"), net: sum("net"), receipts: out.reduce((n, r) => n + r.receipts, 0), reversals: out.reduce((n, r) => n + r.reversals, 0) },
  };
}

export async function outstandingBy(db: Database, actor: Actor, by: "project" | "agent") {
  const { rows, totals } = await outstandingBookings(db, actor, {});
  const groups = new Map<string, { key: string; label: string; bookings: number; total: number; paid: number; outstanding: number }>();
  for (const r of rows) {
    const label = by === "project" ? r.projectName : r.agentName ?? "No agent";
    const g = groups.get(label) ?? { key: label, label, bookings: 0, total: 0, paid: 0, outstanding: 0 };
    g.bookings += 1;
    g.total += toPaisa(r.totalSale);
    g.paid += toPaisa(r.paid);
    g.outstanding += toPaisa(r.outstanding);
    groups.set(label, g);
  }
  const out = [...groups.values()]
    .map((g) => ({ ...g, total: money(g.total), paid: money(g.paid), outstanding: money(g.outstanding) }))
    .sort((a, b) => b.outstanding - a.outstanding || a.label.localeCompare(b.label));
  return { by, rows: out, totals: { ...totals, bookings: rows.length } };
}

export const REPORT_KINDS = ["collections", "outstanding_project", "outstanding_agent", "income_expense"] as const;
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
  const kind = z.enum(REPORT_KINDS).catch("collections").parse(input.report);
  let body: string;
  let filename: string;
  let summary: Record<string, unknown>;
  if (kind === "income_expense") {
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
      ["Project", "From", "To", "Receipts", "Received (PKR)", "Reversals", "Reversed (PKR)", "Net collected (PKR)"],
      [...r.rows.map((x) => [x.project, r.range.from, r.range.to, x.receipts, x.received, x.reversals, x.reversed, x.net]), ["Total", r.range.from, r.range.to, r.totals.receipts, r.totals.received, r.totals.reversals, r.totals.reversed, r.totals.net]],
    );
    filename = `collections-${r.range.from}-to-${r.range.to}.csv`;
    summary = { range: r.range, totals: r.totals };
  } else {
    const by = kind === "outstanding_project" ? "project" : "agent";
    const r = await outstandingBy(db, actor, by);
    const today = businessToday();
    body = csv(
      [by === "project" ? "Project" : "Agent", "As of", "Bookings", "Total sale (PKR)", "Paid (PKR)", "Outstanding (PKR)"],
      [...r.rows.map((x) => [x.label, today, x.bookings, x.total, x.paid, x.outstanding]), ["Total", today, r.totals.bookings, r.totals.total, r.totals.paid, r.totals.outstanding]],
    );
    filename = `outstanding-by-${by}-${today}.csv`;
    summary = { asOf: today, totals: r.totals };
  }
  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "finance.report_export", entity: "finance_report", entityId: kind, after: summary });
  return { body, filename };
}
