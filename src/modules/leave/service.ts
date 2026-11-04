import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database } from "@/server/db";
import { appSettings, auditLogs, employeeProfiles, leaveDecisions, leaveRequests, rosterEntries, teamMembers, teams, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { businessToday } from "@/modules/bookings/today";
import { isUniqueViolation } from "@/modules/leads/support";
import { parseTask as parse } from "@/modules/tasks/support";
import {
  approvalPathFor,
  calendarDays,
  datesOf,
  CROSS_YEAR_HELD_NOTE,
  DEFAULT_ANNUAL_DAYS,
  DEFAULT_PRORATION_METHOD,
  PRORATION_METHODS,
  type ProrationMethod,
  isCrossYear,
  GRANTED_STATUSES,
  HOLDING_STATUSES,
  LEAVE_TYPES,
  proratedAllowance,
  STAFF_STEP_APPROVERS,
  yearOf,
  type LeaveStatus,
  type StaffStepApprover,
} from "./rules";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbOrTx = Database | Tx;

const KEYS = { annualDays: "leave.annual_days", staffStep1: "leave.staff_step1", staffStep2: "leave.staff_step2", prorationMethod: "leave.proration_method" } as const;
const requester = alias(users, "leave_requester");
const deciderUser = alias(users, "leave_decider");
const fieldError = (field: string, message: string) => new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { [field]: message } });

// ─── Permissions ─────────────────────────────────────────────────────────────

/** HR, Admins and Super Admins see everyone's leave; managers see their teams' (for approvals). */
export const canViewAllLeave = (actor: Pick<Actor, "role">) => actor.role === "hr" || actor.role === "admin" || actor.role === "super_admin";
export const canOpenLeaveAdmin = (actor: Pick<Actor, "role">) => canViewAllLeave(actor) || actor.role === "manager";
export const canManageLeaveSettings = (actor: Pick<Actor, "role">) => actor.role === "admin" || actor.role === "super_admin";
/** Q15: cancelling approved leave is approved by an Admin or Super Admin. */
export const canCancelApprovedLeave = (actor: Pick<Actor, "role">) => actor.role === "admin" || actor.role === "super_admin";

// ─── Settings ────────────────────────────────────────────────────────────────

export type LeaveSettings = { annualDays: number; staffStep1: StaffStepApprover | null; staffStep2: StaffStepApprover | null; prorationMethod: ProrationMethod };

export async function getLeaveSettings(db: DbOrTx): Promise<LeaveSettings> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, Object.values(KEYS)));
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const step = (v: string | null) => (STAFF_STEP_APPROVERS as readonly string[]).includes(v ?? "") ? (v as StaffStepApprover) : null;
  const annual = Number(get(KEYS.annualDays));
  const method = get(KEYS.prorationMethod);
  return {
    annualDays: Number.isFinite(annual) && annual > 0 ? annual : DEFAULT_ANNUAL_DAYS,
    staffStep1: step(get(KEYS.staffStep1)),
    staffStep2: step(get(KEYS.staffStep2)),
    prorationMethod: method && method in PRORATION_METHODS ? (method as ProrationMethod) : DEFAULT_PRORATION_METHOD,
  };
}

const settingsSchema = z
  .object({
    annualDays: z.coerce.number("Enter a number").int("Use whole days").min(1, "At least 1 day").max(366, "At most 366 days"),
    staffStep1: z.enum(STAFF_STEP_APPROVERS).nullable().optional().transform((v) => v ?? null),
    staffStep2: z.enum(STAFF_STEP_APPROVERS).nullable().optional().transform((v) => v ?? null),
    prorationMethod: z.enum(Object.keys(PRORATION_METHODS) as [ProrationMethod, ...ProrationMethod[]]).optional().default(DEFAULT_PRORATION_METHOD),
  })
  .strict()
  .refine((v) => (v.staffStep1 === null) === (v.staffStep2 === null), { path: ["staffStep2"], message: "Set both approval steps, or neither (Q6: two-step approval)" });

/** Admins only. The two staff steps stay unset until the client says who approves first and second (C-4). */
export async function updateLeaveSettings(db: Database, actor: Actor, input: unknown) {
  if (!canManageLeaveSettings(actor)) throw forbidden();
  const data = parse(settingsSchema, input);
  return db.transaction(async (tx) => {
    const before = await getLeaveSettings(tx);
    const changed = (Object.keys(KEYS) as (keyof typeof KEYS)[]).filter((k) => before[k] !== data[k]);
    for (const k of changed) {
      const value = data[k];
      if (value === null) await tx.delete(appSettings).where(eq(appSettings.key, KEYS[k]));
      else
        await tx
          .insert(appSettings)
          .values({ key: KEYS[k], value: String(value), updatedById: actor.id })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: String(value), updatedById: actor.id, updatedAt: new Date() } });
      await tx.insert(auditLogs).values({ actorId: actor.id, action: "app.setting", entity: "app_setting", entityId: KEYS[k], before: { value: before[k] }, after: { value } });
    }
    return { changed: changed as string[] };
  });
}

// ─── Balances ────────────────────────────────────────────────────────────────

/** Allowance, granted, pending and remaining days for one person and calendar year. */
export async function leaveBalance(db: DbOrTx, userId: string, year: number) {
  // Sequential on purpose: inside a transaction all queries share one connection.
  const settings = await getLeaveSettings(db);
  const [profile] = await db.select({ joiningDate: employeeProfiles.joiningDate }).from(employeeProfiles).where(eq(employeeProfiles.userId, userId)).limit(1);
  const [sums] = await db
      .select({
        granted: sql<number>`coalesce(sum(${leaveRequests.days}) filter (where ${leaveRequests.status} in ('approved', 'cancel_requested')), 0)::int`,
        pending: sql<number>`coalesce(sum(${leaveRequests.days}) filter (where ${leaveRequests.status} = 'pending'), 0)::int`,
        medical: sql<number>`coalesce(sum(${leaveRequests.days}) filter (where ${leaveRequests.status} in ('approved', 'cancel_requested') and ${leaveRequests.type} = 'medical'), 0)::int`,
      })
      .from(leaveRequests)
      // Held cross-year requests (Q17, C-13) count against neither year until the rule is confirmed.
      .where(and(eq(leaveRequests.userId, userId), sql`extract(year from ${leaveRequests.startDate}) = ${year}`, sql`extract(year from ${leaveRequests.endDate}) = ${year}`));
  const allowance = proratedAllowance(settings.annualDays, profile?.joiningDate ?? null, year, settings.prorationMethod);
  return {
    year,
    annualDays: settings.annualDays,
    allowance: allowance.days,
    prorated: allowance.prorated,
    /** True when the allowance used a proration method the client hasn't confirmed (C-10). */
    provisional: allowance.provisional,
    granted: sums.granted,
    pending: sums.pending,
    medical: sums.medical,
    remaining: allowance.days - sums.granted - sums.pending,
  };
}

// ─── Requests ────────────────────────────────────────────────────────────────

const dateString = (label: string) => z.iso.date(`Choose the ${label} date`);
const requestSchema = z
  .object({
    type: z.enum(LEAVE_TYPES, "Choose a leave type"),
    startDate: dateString("first"),
    endDate: dateString("last"),
    reason: z.string().trim().max(500, "Use at most 500 characters").optional().nullable().transform((v) => (v ? v : null)),
  })
  .strict()
  .refine((v) => v.startDate <= v.endDate, { path: ["endDate"], message: "The last day must be on or after the first day" });

const decisionSchema = z.object({ approve: z.boolean(), comment: z.string().trim().max(500, "Use at most 500 characters").optional().nullable().transform((v) => (v ? v : null)) }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(1, "Give a reason").max(500, "Use at most 500 characters") }).strict();

async function audit(tx: Tx, actor: Actor, action: string, id: string, after: Record<string, unknown>) {
  await tx.insert(auditLogs).values({ actorId: actor.id, action, entity: "leave_request", entityId: id, before: null, after });
}

/**
 * Submit own leave (all roles). Past dates are allowed (Q16); a request over the remaining balance
 * is refused (Q12); overlapping requests are refused (FR-142). A request across two calendar years
 * is recorded but held (Q17, C-13): no balance is checked or deducted and it can't be approved yet.
 */
export async function submitLeave(db: Database, actor: Actor, input: unknown) {
  const data = parse(requestSchema, input);
  const held = isCrossYear(data);
  const days = calendarDays(data.startDate, data.endDate);
  return db.transaction(async (tx) => {
    // Serialise this person's requests so two submissions can't both pass the balance check.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, actor.id)).for("update");
    const clash = await tx
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.userId, actor.id), inArray(leaveRequests.status, HOLDING_STATUSES), sql`${leaveRequests.startDate} <= ${data.endDate} and ${data.startDate} <= ${leaveRequests.endDate}`))
      .limit(1);
    if (clash.length) throw fieldError("startDate", "You already have leave requested or approved on some of these days.");
    const balance = held ? null : await leaveBalance(tx, actor.id, yearOf(data.startDate));
    if (balance && days > balance.remaining) {
      throw fieldError("endDate", `This is ${days} day${days === 1 ? "" : "s"}, but only ${Math.max(0, balance.remaining)} remain for ${balance.year}.`);
    }
    const [row] = await tx
      .insert(leaveRequests)
      .values({ userId: actor.id, type: data.type, startDate: data.startDate, endDate: data.endDate, days, reason: data.reason, approvalPath: approvalPathFor(actor.role) })
      .returning({ id: leaveRequests.id });
    await audit(tx, actor, "leave.request", row.id, { type: data.type, startDate: data.startDate, endDate: data.endDate, days, held });
    return { id: row.id, days, held };
  });
}

async function loadRequest(db: DbOrTx, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Leave request");
  const q = db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw notFound("Leave request");
  return row;
}

/** Teams the requester belongs to whose manager is `managerId`. */
async function managesRequester(db: DbOrTx, managerId: string, requesterId: string) {
  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .where(and(eq(teams.managerId, managerId), eq(teamMembers.userId, requesterId), eq(teams.isActive, true)))
    .limit(1);
  return Boolean(row);
}

export const SAME_APPROVER_MESSAGE = "You approved step 1 of this request. Step 2 needs a different approver.";

/** Who approved step 1 of a two-step request (null when nobody has yet). */
async function stepOneApproverId(db: DbOrTx, requestId: string) {
  const [row] = await db
    .select({ actorId: leaveDecisions.actorId })
    .from(leaveDecisions)
    .where(and(eq(leaveDecisions.requestId, requestId), eq(leaveDecisions.kind, "approval"), eq(leaveDecisions.step, 1), eq(leaveDecisions.approved, true)))
    .limit(1);
  return row?.actorId ?? null;
}

/**
 * Whether `actor` may decide the request's current approval step. Nobody approves their own leave,
 * and the two staff steps need two different people (F-6), even when both steps are the same role.
 */
export async function canDecideStep(db: DbOrTx, actor: Actor, request: { id: string; userId: string; approvalPath: string; currentStep: number; status: string; startDate: string; endDate: string }, settings: LeaveSettings) {
  if (request.status !== "pending" || actor.id === request.userId) return false;
  if (isCrossYear(request)) return false;
  if (request.approvalPath === "senior") return actor.role === "super_admin";
  const approver = request.currentStep === 1 ? settings.staffStep1 : settings.staffStep2;
  if (approver === null) return false;
  if (request.currentStep === 2 && (await stepOneApproverId(db, request.id)) === actor.id) return false;
  if (approver === "hr") return actor.role === "hr";
  if (approver === "admin") return actor.role === "admin" || actor.role === "super_admin";
  return actor.role === "manager" && (await managesRequester(db, actor.id, request.userId));
}

/** Writes "On leave" for each day (Q18) on the person's first active team, without replacing a day a manager already set (C-14). */
async function writeRoster(tx: Tx, actor: Actor, request: { id: string; userId: string; startDate: string; endDate: string }) {
  const [team] = await tx
    .select({ id: teams.id })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, request.userId), eq(teams.isActive, true)))
    .orderBy(asc(teams.name))
    .limit(1);
  if (!team) return 0;
  const days = datesOf(request.startDate, request.endDate);
  const inserted = await tx
    .insert(rosterEntries)
    .values(days.map((date) => ({ teamId: team.id, userId: request.userId, date, status: "on_leave" as const, setById: actor.id, leaveRequestId: request.id })))
    .onConflictDoNothing({ target: [rosterEntries.userId, rosterEntries.date] })
    .returning({ id: rosterEntries.id });
  return inserted.length;
}

/** Approve or reject the current step. A staff request needs both configured steps (Q6). */
export async function decideLeave(db: Database, actor: Actor, id: string, input: unknown) {
  const data = parse(decisionSchema, input);
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, id, true);
    const settings = await getLeaveSettings(tx);
    if (request.status !== "pending") throw new AppError("BUSINESS_RULE", "This request has already been decided.");
    if (isCrossYear(request)) throw new AppError("BUSINESS_RULE", CROSS_YEAR_HELD_NOTE);
    if (!(await canDecideStep(tx, actor, request, settings))) {
      if (request.approvalPath === "staff" && !settings.staffStep1) throw new AppError("BUSINESS_RULE", "Staff leave approval steps are not set yet (awaiting the company's approval order).");
      if (request.approvalPath === "staff" && request.currentStep === 2 && (await stepOneApproverId(tx, id)) === actor.id) throw forbidden(SAME_APPROVER_MESSAGE);
      throw forbidden(actor.id === request.userId ? "You can't decide your own leave." : "You can't decide this step.");
    }
    try {
      await tx.transaction((sp) => sp.insert(leaveDecisions).values({ requestId: id, kind: "approval", step: request.currentStep, approved: data.approve, actorId: actor.id, comment: data.comment }));
    } catch (error) {
      if (isUniqueViolation(error, "leave_decisions_one_approval_per_actor_uq")) throw forbidden(SAME_APPROVER_MESSAGE);
      throw error;
    }
    const now = new Date();
    const finalStep = request.approvalPath === "senior" || request.currentStep === 2;
    if (!data.approve) {
      await tx.update(leaveRequests).set({ status: "rejected", decidedAt: now, updatedAt: now }).where(eq(leaveRequests.id, id));
      await audit(tx, actor, "leave.reject", id, { step: request.currentStep, comment: data.comment });
      return { status: "rejected" as const };
    }
    if (!finalStep) {
      await tx.update(leaveRequests).set({ currentStep: 2, updatedAt: now }).where(eq(leaveRequests.id, id));
      await audit(tx, actor, "leave.approve_step", id, { step: 1 });
      return { status: "pending" as const, nextStep: 2 };
    }
    await tx.update(leaveRequests).set({ status: "approved", decidedAt: now, updatedAt: now }).where(eq(leaveRequests.id, id));
    const rosterDays = await writeRoster(tx, actor, request);
    await audit(tx, actor, "leave.approve", id, { step: request.currentStep, rosterDays });
    return { status: "approved" as const, rosterDays };
  });
}

/** The requester withdraws a request that is still pending. */
export async function withdrawLeave(db: Database, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, id, true);
    if (request.userId !== actor.id) throw notFound("Leave request");
    if (request.status !== "pending") throw new AppError("BUSINESS_RULE", "Only pending requests can be withdrawn.");
    await tx.update(leaveRequests).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(leaveRequests.id, id));
    await tx.insert(leaveDecisions).values({ requestId: id, kind: "withdrawal", approved: true, actorId: actor.id });
    await audit(tx, actor, "leave.withdraw", id, {});
    return { status: "withdrawn" as const };
  });
}

/** Q15: the requester asks to cancel approved leave; an Admin or Super Admin decides. */
export async function requestLeaveCancellation(db: Database, actor: Actor, id: string, input: unknown) {
  const { reason } = parse(reasonSchema, input);
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, id, true);
    if (request.userId !== actor.id) throw notFound("Leave request");
    if (request.status !== "approved") throw new AppError("BUSINESS_RULE", "Only approved leave can be cancelled.");
    await tx.update(leaveRequests).set({ status: "cancel_requested", updatedAt: new Date() }).where(eq(leaveRequests.id, id));
    await tx.insert(leaveDecisions).values({ requestId: id, kind: "cancel_request", approved: true, actorId: actor.id, comment: reason });
    await audit(tx, actor, "leave.cancel_request", id, { reason });
    return { status: "cancel_requested" as const };
  });
}

async function finishCancellation(tx: Tx, actor: Actor, id: string, comment: string | null) {
  const now = new Date();
  await tx.update(leaveRequests).set({ status: "cancelled", decidedAt: now, updatedAt: now }).where(eq(leaveRequests.id, id));
  // Only roster days written by this leave are removed; days a manager set stay.
  const removed = await tx.delete(rosterEntries).where(eq(rosterEntries.leaveRequestId, id)).returning({ id: rosterEntries.id });
  await tx.insert(leaveDecisions).values({ requestId: id, kind: "cancellation", approved: true, actorId: actor.id, comment });
  await audit(tx, actor, "leave.cancel", id, { comment, rosterDaysRemoved: removed.length });
  return { status: "cancelled" as const, rosterDaysRemoved: removed.length };
}

/** Admin / Super Admin: approve or refuse a cancellation request (Q15). Cancelled days return to the balance. */
export async function decideLeaveCancellation(db: Database, actor: Actor, id: string, input: unknown) {
  if (!canCancelApprovedLeave(actor)) throw forbidden();
  const data = parse(decisionSchema, input);
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, id, true);
    if (request.status !== "cancel_requested") throw new AppError("BUSINESS_RULE", "There is no cancellation request to decide.");
    if (request.userId === actor.id) throw forbidden("You can't decide the cancellation of your own leave.");
    if (data.approve) return finishCancellation(tx, actor, id, data.comment);
    await tx.update(leaveRequests).set({ status: "approved", updatedAt: new Date() }).where(eq(leaveRequests.id, id));
    await tx.insert(leaveDecisions).values({ requestId: id, kind: "cancellation", approved: false, actorId: actor.id, comment: data.comment });
    await audit(tx, actor, "leave.cancel_refused", id, { comment: data.comment });
    return { status: "approved" as const };
  });
}

/** Admin / Super Admin cancel approved leave directly, with a reason (Q15). */
export async function cancelApprovedLeave(db: Database, actor: Actor, id: string, input: unknown) {
  if (!canCancelApprovedLeave(actor)) throw forbidden();
  const { reason } = parse(reasonSchema, input);
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, id, true);
    if (!(GRANTED_STATUSES as string[]).includes(request.status)) throw new AppError("BUSINESS_RULE", "Only approved leave can be cancelled.");
    if (request.userId === actor.id) throw forbidden("You can't cancel your own leave here; request a cancellation instead.");
    return finishCancellation(tx, actor, id, reason);
  });
}

// ─── Lists ───────────────────────────────────────────────────────────────────

const listSelect = {
  id: leaveRequests.id,
  userId: leaveRequests.userId,
  userName: requester.name,
  userRole: requester.role,
  type: leaveRequests.type,
  startDate: leaveRequests.startDate,
  endDate: leaveRequests.endDate,
  days: leaveRequests.days,
  reason: leaveRequests.reason,
  status: leaveRequests.status,
  approvalPath: leaveRequests.approvalPath,
  currentStep: leaveRequests.currentStep,
  createdAt: leaveRequests.createdAt,
};
export type LeaveRow = { id: string; userId: string; userName: string; userRole: string; type: "annual" | "medical"; startDate: string; endDate: string; days: number; reason: string | null; status: LeaveStatus; approvalPath: string; currentStep: number; createdAt: Date };

/** The signed-in person's requests and balance for a year, and the years they have requests in. */
export async function myLeave(db: Database, actor: Actor, year = yearOf(businessToday())) {
  const [balance, rows, years] = await Promise.all([
    leaveBalance(db, actor.id, year),
    db
      .select(listSelect)
      .from(leaveRequests)
      .innerJoin(requester, eq(requester.id, leaveRequests.userId))
      .where(and(eq(leaveRequests.userId, actor.id), sql`extract(year from ${leaveRequests.startDate}) = ${year}`))
      .orderBy(desc(leaveRequests.startDate)),
    leaveYears(db, eq(leaveRequests.userId, actor.id)),
  ]);
  return { year, years, balance, rows: rows as LeaveRow[] };
}

export const LEAVE_PAGE_SIZE = 50;
export const LEAVE_STATUS_FILTERS = ["pending", "approved", "rejected", "withdrawn", "cancel_requested", "cancelled"] as const;
export const LEAVE_SORT_COLUMNS = ["employee", "type", "dates", "status", "requested"] as const;
export type LeaveSortColumn = (typeof LEAVE_SORT_COLUMNS)[number];
const LEAVE_SORTS: Record<LeaveSortColumn, SQL> = {
  employee: sql`lower(${requester.name})`,
  type: sql`${leaveRequests.type}`,
  dates: sql`${leaveRequests.startDate}`,
  status: sql`${leaveRequests.status}`,
  requested: sql`${leaveRequests.createdAt}`,
};
const leaveListQuery = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(LEAVE_STATUS_FILTERS).optional().catch(undefined),
  type: z.enum(LEAVE_TYPES).optional().catch(undefined),
  sort: z.enum(LEAVE_SORT_COLUMNS).catch("requested"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/** Leave years with at least one request in the actor's scope, plus the current year (year selector). */
async function leaveYears(db: Database, scope: SQL) {
  const rows = await db
    .selectDistinct({ year: sql<number>`extract(year from ${leaveRequests.startDate})::int` })
    .from(leaveRequests)
    .where(scope);
  return [...new Set([yearOf(businessToday()), ...rows.map((r) => Number(r.year))])].sort((a, b) => b - a);
}

/**
 * Leave admin view: requests the actor may see (HR / Admin / Super Admin: all; managers: their teams).
 * - The list covers one calendar year (C-11: calendar year until confirmed), with search, status,
 *   type, sorting and 50 per page.
 * - "Waiting for your decision" and cancellation requests (Admin / Super Admin) cover every year and
 *   ignore the list filters, so nothing that needs a decision is hidden by them.
 */
export async function leaveOverview(db: Database, actor: Actor, year = yearOf(businessToday()), rawQuery: unknown = {}) {
  if (!canOpenLeaveAdmin(actor)) throw forbidden();
  const query = leaveListQuery.parse(rawQuery ?? {});
  const settings = await getLeaveSettings(db);
  let scope: SQL = sql`true`;
  if (!canViewAllLeave(actor)) {
    const members = actor.managedTeamIds.length
      ? (await db.selectDistinct({ id: teamMembers.userId }).from(teamMembers).where(inArray(teamMembers.teamId, actor.managedTeamIds))).map((r) => r.id)
      : [];
    scope = members.length ? inArray(leaveRequests.userId, members) : sql`false`;
  }
  const term = query.q ? `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const where = and(
    scope,
    sql`extract(year from ${leaveRequests.startDate}) = ${year}`,
    query.status ? eq(leaveRequests.status, query.status) : undefined,
    query.type ? eq(leaveRequests.type, query.type) : undefined,
    term ? or(ilike(requester.name, term), ilike(leaveRequests.reason, term)) : undefined,
  );
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(leaveRequests).innerJoin(requester, eq(requester.id, leaveRequests.userId)).where(where);
  const pageCount = Math.max(1, Math.ceil(total / LEAVE_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const column = LEAVE_SORTS[query.sort];
  const rows = (await db
    .select(listSelect)
    .from(leaveRequests)
    .innerJoin(requester, eq(requester.id, leaveRequests.userId))
    .where(where)
    .orderBy(query.dir === "asc" ? sql`${column} asc` : sql`${column} desc`, desc(leaveRequests.createdAt), desc(leaveRequests.id))
    .limit(LEAVE_PAGE_SIZE)
    .offset((page - 1) * LEAVE_PAGE_SIZE)) as LeaveRow[];

  const open = (await db
    .select(listSelect)
    .from(leaveRequests)
    .innerJoin(requester, eq(requester.id, leaveRequests.userId))
    .where(and(scope, inArray(leaveRequests.status, ["pending", "cancel_requested"])))
    .orderBy(asc(leaveRequests.createdAt))) as LeaveRow[];
  const decidable: LeaveRow[] = [];
  for (const r of open) if (r.status === "pending" && (await canDecideStep(db, actor, r, settings))) decidable.push(r);
  const cancellations = canCancelApprovedLeave(actor) ? open.filter((r) => r.status === "cancel_requested" && r.userId !== actor.id) : [];
  return { year, years: await leaveYears(db, scope), settings, query: { ...query, page }, total, page, pageCount, rows, decidable, cancellations };
}

/** Decisions on one request, oldest first (for the history column). */
export async function leaveDecisionHistory(db: Database, requestIds: string[]) {
  if (!requestIds.length) return [];
  return db
    .select({ requestId: leaveDecisions.requestId, kind: leaveDecisions.kind, step: leaveDecisions.step, approved: leaveDecisions.approved, comment: leaveDecisions.comment, actorName: deciderUser.name, createdAt: leaveDecisions.createdAt })
    .from(leaveDecisions)
    .leftJoin(deciderUser, eq(deciderUser.id, leaveDecisions.actorId))
    .where(inArray(leaveDecisions.requestId, requestIds))
    .orderBy(asc(leaveDecisions.createdAt));
}

/**
 * Leave balances for the year ("Leave balances" in the quotation): every active CRM user for HR,
 * Admins and Super Admins; a manager's team members for managers. Same rules as `leaveBalance`.
 */
export async function leaveBalances(db: Database, actor: Actor, year = yearOf(businessToday())) {
  if (!canOpenLeaveAdmin(actor)) throw forbidden();
  let people = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.status, "active")).orderBy(asc(sql`lower(${users.name})`));
  if (!canViewAllLeave(actor)) {
    const members = actor.managedTeamIds.length
      ? new Set((await db.selectDistinct({ id: teamMembers.userId }).from(teamMembers).where(inArray(teamMembers.teamId, actor.managedTeamIds))).map((r) => r.id))
      : new Set<string>();
    people = people.filter((p) => members.has(p.id));
  }
  const rows = [];
  for (const p of people) rows.push({ ...p, ...(await leaveBalance(db, p.id, year)) });
  return { year, rows };
}

/** One person's balance, for the employee page (HR, Admin, Super Admin, or the person's team manager). */
export async function employeeLeaveBalance(db: Database, actor: Actor, userId: string, year = yearOf(businessToday())) {
  if (!canOpenLeaveAdmin(actor)) throw forbidden();
  if (!canViewAllLeave(actor) && !(await managesRequester(db, actor.id, userId))) throw forbidden();
  return leaveBalance(db, userId, year);
}
