import { and, asc, count, desc, eq, gt, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database } from "@/server/db";
import { auditLogs, bookingPayments, bookings, leads, paymentMethods, paymentReversalRequests, projects, taskInstallmentRows, tasks, units, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden, notFound } from "@/server/errors";
import { MILESTONE_RATIO } from "@/modules/bookings/constants";
import { canAccessBooking } from "@/modules/bookings/policy";
import { businessToday } from "@/modules/bookings/today";
import { teamMemberIds } from "@/modules/leads/support";
import { OUTSTANDING_PAGE_SIZE, OUTSTANDING_SORT_COLUMNS, PAYABLE_STAGES, type OutstandingSortColumn } from "./constants";
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
  overdue: z.enum(["yes"]).optional().catch(undefined),
  agent: z.uuid().optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});
const outstandingListSchema = outstandingQuerySchema.extend({
  sort: z.enum(OUTSTANDING_SORT_COLUMNS).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/**
 * FR-203 per-booking balances (all bookings except cancelled): total, paid (from rows), outstanding,
 * milestone. "Overdue vs schedule" needs installment schedules, which don't exist yet.
 */
/**
 * FR-203 "overdue vs schedule". The schedule is the booking's payment plan: its most recent
 * Payment-plan task that isn't cancelled. Installments carry due dates (the 10th, Q43).
 * - Due to date = the plan's installments dated on or before today (Pakistan date).
 * - Rows without a date (the down payment until C-27 is answered, and plans saved before due
 *   dates existed) are not counted and are reported separately.
 * - A booking without a plan has no schedule: its figures are null, never guessed.
 */
export async function scheduleDueByBooking(db: Database, bookingIds: string[], today = businessToday()) {
  const out = new Map<string, { planTaskId: string; dueToDate: number; undatedRows: number }>();
  if (!bookingIds.length) return out;
  const plans = await db
    .selectDistinctOn([tasks.bookingId], { bookingId: tasks.bookingId, taskId: tasks.id })
    .from(tasks)
    .where(and(inArray(tasks.bookingId, bookingIds), eq(tasks.type, "payment_plan"), ne(tasks.status, "cancelled")))
    .orderBy(tasks.bookingId, desc(tasks.createdAt));
  if (!plans.length) return out;
  const sums = await db
    .select({
      taskId: taskInstallmentRows.taskId,
      due: sql<string>`coalesce(sum(${taskInstallmentRows.amount}) filter (where ${taskInstallmentRows.dueOn} <= ${today}), 0)`,
      undated: sql<number>`count(*) filter (where ${taskInstallmentRows.dueOn} is null)::int`,
    })
    .from(taskInstallmentRows)
    .where(inArray(taskInstallmentRows.taskId, plans.map((p) => p.taskId)))
    .groupBy(taskInstallmentRows.taskId);
  for (const p of plans) {
    const s = sums.find((x) => x.taskId === p.taskId);
    out.set(p.bookingId!, { planTaskId: p.taskId, dueToDate: Number(s?.due ?? 0), undatedRows: s?.undated ?? 0 });
  }
  return out;
}

const outstandingAgent = alias(users, "agent");
const outstandingFields = {
  bookingId: bookings.id,
  stage: bookings.stage,
  totalSale: bookings.totalSale,
  leadName: leads.name,
  leadCode: leads.code,
  unitNo: units.unitNo,
  projectName: projects.name,
  agentId: bookings.agentId,
  agentName: outstandingAgent.name,
};
type OutstandingBase = { bookingId: string; totalSale: number };

/** Bookings that aren't cancelled, within the list's project, agent and search filters. */
function outstandingWhere(q: { project?: string; agent?: string; q?: string }) {
  const term = q.q ? `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  return and(
    ne(bookings.stage, "cancelled"),
    q.project ? eq(bookings.projectId, q.project) : undefined,
    q.agent ? eq(bookings.agentId, q.agent) : undefined,
    term ? or(ilike(leads.name, term), ilike(leads.code, term), ilike(units.unitNo, term)) : undefined,
  );
}

/** Adds each booking's balances (FR-203): the one place these figures are worked out for display. */
async function withBalances<T extends OutstandingBase>(db: Database, rows: T[], today: string) {
  const [paid, schedule] = await Promise.all([netPaidByBooking(db, rows.map((r) => r.bookingId)), scheduleDueByBooking(db, rows.map((r) => r.bookingId), today)]);
  return rows.map((r) => {
    const p = paid.get(r.bookingId) ?? 0;
    const plan = schedule.get(r.bookingId) ?? null;
    const overdue = plan ? Math.max(0, toPaisa(plan.dueToDate) - toPaisa(p)) / 100 : null;
    return {
      ...r,
      paid: p,
      outstanding: (toPaisa(r.totalSale) - toPaisa(p)) / 100,
      milestoneMet: toPaisa(p) >= toPaisa(r.totalSale * MILESTONE_RATIO),
      planTaskId: plan?.planTaskId ?? null,
      dueToDate: plan?.dueToDate ?? null,
      undatedRows: plan?.undatedRows ?? 0,
      overdue,
    };
  });
}

/** Sales agents with an open (not cancelled) booking, for the agent filter. */
function outstandingAgents(db: Database) {
  return db
    .selectDistinct({ id: outstandingAgent.id, name: outstandingAgent.name })
    .from(bookings)
    .innerJoin(outstandingAgent, eq(outstandingAgent.id, bookings.agentId))
    .where(ne(bookings.stage, "cancelled"))
    .orderBy(outstandingAgent.name);
}

/**
 * The Outstanding screen (FR-005, FR-203): sorted, filtered and paged in the database, 50 per page.
 * SQL only decides which bookings and in what order, and sums the totals; the figures shown on each
 * row come from `withBalances`, like the reports. Tests hold the SQL and `outstandingBookings` equal.
 */
export async function listOutstanding(db: Database, actor: Actor, rawQuery: unknown, today = businessToday()) {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  const q = outstandingListSchema.parse(rawQuery ?? {});
  const planId = sql`(select t.id from tasks t where t.booking_id = ${bookings.id} and t.type = 'payment_plan' and t.status <> 'cancelled' order by t.created_at desc limit 1)`;
  const base = db
    .select({
      ...outstandingFields,
      // Three tables have a `name`: inside a subquery each needs its own.
      leadName: sql<string>`${leads.name}`.as("lead_name"),
      projectName: sql<string>`${projects.name}`.as("project_name"),
      agentName: sql<string | null>`${outstandingAgent.name}`.as("agent_name"),
      paid: sql<string>`(select coalesce(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 0) from booking_payments p where p.booking_id = ${bookings.id})`.as("paid"),
      due: sql<string | null>`case when ${planId} is null then null else (select coalesce(sum(r.amount), 0) from task_installment_rows r where r.task_id = ${planId} and r.due_on <= ${today}::date) end`.as("due"),
    })
    .from(bookings)
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .leftJoin(outstandingAgent, eq(outstandingAgent.id, bookings.agentId))
    .where(outstandingWhere(q))
    .as("o");
  const owed = sql`(${base.totalSale} - ${base.paid})`;
  const overdue = sql`(case when ${base.due} is null then null else greatest(0, ${base.due} - ${base.paid}) end)`;
  const met = sql`(${base.paid} >= round(${base.totalSale} * ${MILESTONE_RATIO}, 2))`;
  const where = and(q.milestone ? (q.milestone === "met" ? met : sql`not ${met}`) : undefined, q.overdue ? gt(overdue, 0) : undefined);
  /** The only expressions a sort can reach: `sort` is validated against this list's keys. */
  const SORTS: Record<OutstandingSortColumn, SQL> = {
    lead: sql`lower(${base.leadName})`,
    unit: sql`lower(${base.unitNo})`,
    project: sql`lower(${base.projectName})`,
    agent: sql`lower(${base.agentName})`,
    stage: sql`${base.stage}`,
    total: sql`${base.totalSale}`,
    paid: sql`${base.paid}`,
    outstanding: owed,
    due: sql`${base.due}`,
    overdue,
    milestone: met,
  };
  const [sums] = await db
    .select({
      n: count(),
      total: sql<string>`coalesce(sum(${base.totalSale}), 0)`,
      paid: sql<string>`coalesce(sum(${base.paid}), 0)`,
      outstanding: sql<string>`coalesce(sum(${owed}), 0)`,
      overdue: sql<string>`coalesce(sum(${overdue}), 0)`,
    })
    .from(base)
    .where(where);
  const pageCount = Math.max(1, Math.ceil(sums.n / OUTSTANDING_PAGE_SIZE));
  const page = Math.min(q.page, pageCount);
  // The default order, then the id, settle ties, so equal values keep their order from page to page.
  const byDefault = [asc(base.projectName), asc(sql`lower(${base.unitNo})`), asc(base.bookingId)];
  const order = q.sort ? [q.dir === "asc" ? sql`${SORTS[q.sort]} asc nulls last` : sql`${SORTS[q.sort]} desc nulls last`, ...byDefault] : byDefault;
  const rows = await db
    .select({ bookingId: base.bookingId, stage: base.stage, totalSale: base.totalSale, leadName: base.leadName, leadCode: base.leadCode, unitNo: base.unitNo, projectName: base.projectName, agentId: base.agentId, agentName: base.agentName })
    .from(base)
    .where(where)
    .orderBy(...order)
    .limit(OUTSTANDING_PAGE_SIZE)
    .offset((page - 1) * OUTSTANDING_PAGE_SIZE);
  return {
    query: { ...q, page },
    total: sums.n,
    page,
    pageCount,
    rows: await withBalances(db, rows, today),
    agents: await outstandingAgents(db),
    totals: { total: Number(sums.total), paid: Number(sums.paid), outstanding: Number(sums.outstanding), overdue: Number(sums.overdue) },
  };
}

/** Every matching booking with its balances, for reports. The Outstanding screen pages through `listOutstanding`. */
export async function outstandingBookings(db: Database, actor: Actor, rawQuery: unknown, today = businessToday()) {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  const q = outstandingQuerySchema.parse(rawQuery ?? {});
  const rows = await db
    .select(outstandingFields)
    .from(bookings)
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .leftJoin(outstandingAgent, eq(outstandingAgent.id, bookings.agentId))
    .where(outstandingWhere(q))
    .orderBy(asc(projects.name), asc(sql`lower(${units.unitNo})`));
  const all = await withBalances(db, rows, today);
  let rowsOut = q.milestone ? all.filter((r) => (q.milestone === "met" ? r.milestoneMet : !r.milestoneMet)) : all;
  if (q.overdue) rowsOut = rowsOut.filter((r) => (r.overdue ?? 0) > 0);
  const sum = (pick: (r: (typeof rowsOut)[number]) => number) => rowsOut.reduce((acc, r) => acc + toPaisa(pick(r)), 0) / 100;
  const agents = await outstandingAgents(db);
  return { rows: rowsOut, agents, totals: { total: sum((r) => r.totalSale), paid: sum((r) => r.paid), outstanding: sum((r) => r.outstanding), overdue: sum((r) => r.overdue ?? 0) } };
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
