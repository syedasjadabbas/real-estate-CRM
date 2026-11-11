import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { bookings, leads, projects, taskHistory, taskInstallmentRows, tasks, units, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { canAccessBooking, canDoBooking } from "@/modules/bookings/policy";
import { canAccessLead, leadScope } from "@/modules/leads/policy";
import { pageWithin, scopeFilter as leadScopeFilter, teamMemberIds, type DbOrTx } from "@/modules/leads/support";
import { selectableProjects } from "@/modules/projects/queries";
import { ACTIVE_TASK_STATUSES, TASK_PAGE_SIZE } from "./constants";
import { ASSIGNABLE_ROLES, canAccessTask, canDoTask, canEditDownPayment, canEditTaskDetails, discountCap, taskScope } from "./policy";
import { unitPricePerSqft } from "./plan";
import { getProposalSettings } from "./settings";
import { loadAccessibleTask } from "./support";
import { taskListQuerySchema } from "./validation";

const assignee = alias(users, "assignee");
const creator = alias(users, "creator");

function taskScopeFilter(actor: Actor, members: string[]): SQL {
  switch (taskScope(actor.role)) {
    case "all":
      return sql`true`;
    case "team": {
      const people = [actor.id, ...members];
      return or(inArray(tasks.assigneeId, people), inArray(tasks.createdById, people))!;
    }
    case "own":
      return or(eq(tasks.assigneeId, actor.id), eq(tasks.createdById, actor.id))!;
    default:
      throw forbidden();
  }
}

/** Overdue (FR-092): past due and still Open or In progress. */
export const overdueCondition = (now: Date) => and(inArray(tasks.status, ACTIVE_TASK_STATUSES), lt(tasks.dueAt, now))!;
export const isOverdue = (t: { status: string; dueAt: Date | null }, now: Date) =>
  Boolean(t.dueAt && t.dueAt < now && (ACTIVE_TASK_STATUSES as string[]).includes(t.status));

const SORTS = {
  title: sql`lower(${tasks.title})`,
  type: tasks.type,
  status: tasks.status,
  dueAt: tasks.dueAt,
  assignee: sql`lower(${assignee.name})`,
  updatedAt: tasks.updatedAt,
};

export type TaskListRow = Awaited<ReturnType<typeof listTasks>>["rows"][number];

/** FR-090 list: search (title, lead name / code), status, type, assignee, overdue; sortable columns; pages. */
export async function listTasks(db: Database, actor: Actor, rawQuery: unknown, now = new Date()) {
  if (!canDoTask(actor, "view")) throw forbidden();
  const query = taskListQuerySchema.parse(rawQuery ?? {});
  const members = await teamMemberIds(db, actor);
  const term = query.q ? `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const where = and(
    taskScopeFilter(actor, members),
    query.status ? eq(tasks.status, query.status) : undefined,
    query.type ? eq(tasks.type, query.type) : undefined,
    query.assignee ? eq(tasks.assigneeId, query.assignee === "me" ? actor.id : query.assignee) : undefined,
    query.overdue ? overdueCondition(now) : undefined,
    term ? or(ilike(tasks.title, term), ilike(leads.name, term), ilike(leads.code, term)) : undefined,
  );
  const [{ total }] = await db.select({ total: count() }).from(tasks).leftJoin(leads, eq(leads.id, tasks.leadId)).where(where);
  const pageCount = Math.max(1, Math.ceil(total / TASK_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const column = SORTS[query.sort];
  const order = query.dir === "asc" ? sql`${column} asc nulls last` : sql`${column} desc nulls last`;
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      type: tasks.type,
      status: tasks.status,
      dueAt: tasks.dueAt,
      updatedAt: tasks.updatedAt,
      assigneeId: tasks.assigneeId,
      assigneeName: assignee.name,
      leadId: leads.id,
      leadName: leads.name,
      leadCode: leads.code,
      leadOwnerId: leads.ownerId,
    })
    .from(tasks)
    .innerJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .leftJoin(leads, eq(leads.id, tasks.leadId))
    .where(where)
    .orderBy(order, desc(tasks.id))
    .limit(TASK_PAGE_SIZE)
    .offset((page - 1) * TASK_PAGE_SIZE);
  return {
    query: { ...query, page },
    total,
    page,
    pageCount,
    pageSize: TASK_PAGE_SIZE,
    // A linked lead outside the actor's lead scope is not named (no lead data leak through tasks).
    rows: rows.map(({ leadOwnerId, ...r }) => {
      const visible = r.leadId !== null && canAccessLead(actor, leadOwnerId, members);
      return { ...r, leadId: visible ? r.leadId : null, leadName: visible ? r.leadName : null, leadCode: visible ? r.leadCode : null, hasHiddenLead: r.leadId !== null && !visible, overdue: isOverdue(r, now) };
    }),
  };
}

/** People whose tasks the actor can see, for the list's Assignee filter: everyone (admins), self + team (managers), self. */
export async function assigneeFilterUsers(db: DbOrTx, actor: Actor) {
  const members = await teamMemberIds(db, actor);
  const scope = taskScope(actor.role);
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.status, "active"),
        inArray(users.role, ASSIGNABLE_ROLES),
        scope === "all" ? undefined : inArray(users.id, scope === "team" ? [actor.id, ...members] : [actor.id]),
      ),
    )
    .orderBy(asc(users.name));
}

/** Assignees the actor may pick: everyone (Admins and Super Admins), otherwise only themselves (Q45). */
export async function assignableUsers(db: DbOrTx, actor: Actor) {
  const scope = taskScope(actor.role);
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.status, "active"),
        inArray(users.role, ASSIGNABLE_ROLES),
        scope === "all" ? undefined : eq(users.id, actor.id),
      ),
    )
    .orderBy(asc(users.name));
  return rows;
}

/**
 * Options for the create / edit form: assignees, leads and open bookings in the header project
 * (plus whatever the task already links), and projects / units for the proposal builder.
 */
export async function taskFormOptions(db: Database, actor: Actor, projectId: string | null, current: { leadId?: string | null; bookingId?: string | null } = {}) {
  // The edit form needs the options too: HR and Accountants edit tasks assigned to them (Q45) but don't create.
  if (!canDoTask(actor, "create") && !canDoTask(actor, "edit")) throw forbidden();
  const members = await teamMemberIds(db, actor);
  const leadWhere = (extra: SQL | undefined) => and(isNull(leads.deletedAt), leadScopeFilter(actor, members), extra);
  const [assignees, leadRows, bookingRows, projectRows, unitRows, settings] = await Promise.all([
    assignableUsers(db, actor),
    // Roles without lead access (HR, Accountant) get no lead options.
    leadScope(actor.role) === "none"
      ? Promise.resolve([] as { id: string; name: string; code: string }[])
      : db
          .select({ id: leads.id, name: leads.name, code: leads.code })
          .from(leads)
          .where(leadWhere(or(projectId ? eq(leads.projectId, projectId) : undefined, current.leadId ? eq(leads.id, current.leadId) : undefined)))
          .orderBy(asc(leads.name))
          .limit(1000),
    canDoBooking(actor, "view")
      ? db
          .select({ id: bookings.id, leadId: bookings.leadId, agentId: bookings.agentId, leadName: leads.name, leadCode: leads.code, unitNo: units.unitNo, projectName: projects.name })
          .from(bookings)
          .innerJoin(leads, eq(leads.id, bookings.leadId))
          .innerJoin(units, eq(units.id, bookings.unitId))
          .innerJoin(projects, eq(projects.id, bookings.projectId))
          .where(
            or(
              and(projectId ? eq(bookings.projectId, projectId) : undefined, ne(bookings.stage, "cancelled")),
              current.bookingId ? eq(bookings.id, current.bookingId) : undefined,
            ),
          )
          .orderBy(asc(leads.name))
          .limit(1000)
      : Promise.resolve([]),
    selectableProjects(db, actor),
    db
      .select({
        id: units.id,
        projectId: units.projectId,
        unitNo: units.unitNo,
        areaSqft: units.areaSqft,
        basePrice: units.basePrice,
        floor: units.floor,
        status: units.status,
        type: units.type,
        category: units.category,
        bedrooms: units.bedrooms,
      })
      .from(units)
      .innerJoin(projects, eq(projects.id, units.projectId))
      .orderBy(asc(sql`lower(${units.unitNo})`))
      .limit(5000),
    getProposalSettings(db),
  ]);
  const projectIds = new Set(projectRows.map((p) => p.id));
  return {
    assignees,
    leads: leadRows,
    bookings: bookingRows
      .filter((b) => canAccessBooking(actor, b.agentId, members))
      .map((b) => ({ id: b.id, leadId: b.leadId, leadName: b.leadName, leadCode: b.leadCode, unitNo: b.unitNo, projectName: b.projectName })),
    projects: projectRows,
    units: unitRows.filter((u) => projectIds.has(u.projectId)),
    settings,
    limits: { discountCap: discountCap(actor.role, settings), canEditDownPayment: canEditDownPayment(actor.role) },
  };
}
export type TaskFormOptions = Awaited<ReturnType<typeof taskFormOptions>>;

/** Task detail: links (only those the actor may open), plan rows and history with actor names. */
export async function getTaskDetail(db: Database, actor: Actor, taskId: string, now = new Date()) {
  if (!canDoTask(actor, "view")) throw forbidden();
  const { task, members } = await loadAccessibleTask(db, actor, taskId);
  const [people, lead, booking, rows, history, project, unitNow, settings] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [task.assigneeId, ...(task.createdById ? [task.createdById] : [])])),
    task.leadId ? db.select({ id: leads.id, name: leads.name, code: leads.code, ownerId: leads.ownerId }).from(leads).where(eq(leads.id, task.leadId)).then((r) => r[0]) : null,
    task.bookingId
      ? db
          .select({ id: bookings.id, agentId: bookings.agentId, stage: bookings.stage, unitNo: units.unitNo, projectName: projects.name, leadName: leads.name })
          .from(bookings)
          .innerJoin(units, eq(units.id, bookings.unitId))
          .innerJoin(projects, eq(projects.id, bookings.projectId))
          .innerJoin(leads, eq(leads.id, bookings.leadId))
          .where(eq(bookings.id, task.bookingId))
          .then((r) => r[0])
      : null,
    db
      .select({ seq: taskInstallmentRows.seq, label: taskInstallmentRows.label, description: taskInstallmentRows.description, progress: taskInstallmentRows.progress, amount: taskInstallmentRows.amount, dueOn: taskInstallmentRows.dueOn })
      .from(taskInstallmentRows)
      .where(eq(taskInstallmentRows.taskId, task.id))
      .orderBy(asc(taskInstallmentRows.seq)),
    db
      .select({ id: taskHistory.id, action: taskHistory.action, data: taskHistory.data, createdAt: taskHistory.createdAt, actorName: creator.name })
      .from(taskHistory)
      .leftJoin(creator, eq(creator.id, taskHistory.actorId))
      .where(eq(taskHistory.taskId, task.id))
      .orderBy(desc(taskHistory.createdAt), desc(taskHistory.id)),
    task.proposal?.projectId ? db.select({ name: projects.name }).from(projects).where(eq(projects.id, task.proposal.projectId)).then((r) => r[0] ?? null) : null,
    task.proposal?.unitId ? db.select({ areaSqft: units.areaSqft, basePrice: units.basePrice, floor: units.floor }).from(units).where(eq(units.id, task.proposal.unitId)).then((r) => r[0] ?? null) : null,
    task.proposal?.unitId ? getProposalSettings(db) : null,
  ]);
  // Q47: a proposal follows the unit's price. If the unit changed after the last save, say so.
  const currentPrice = unitNow && settings ? unitPricePerSqft(unitNow, settings) : null;
  const unitChanged =
    task.proposal && unitNow && (currentPrice !== task.proposal.pricePerSqft || unitNow.areaSqft !== task.proposal.areaSqft)
      ? { savedPricePerSqft: task.proposal.pricePerSqft, currentPricePerSqft: currentPrice, savedAreaSqft: task.proposal.areaSqft, currentAreaSqft: unitNow.areaSqft }
      : null;
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  // Names for reassignment entries (ids are what the history stores).
  const historyIds = [...new Set(history.flatMap((h) => (h.action === "assign" ? [h.data?.from, h.data?.to] : [])).filter((v): v is string => typeof v === "string"))];
  const historyNames = historyIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, historyIds)) : [];
  const leadVisible = lead ? canAccessLead(actor, lead.ownerId, members) : false;
  const bookingVisible = booking ? canDoBooking(actor, "view") && canAccessBooking(actor, booking.agentId, members) : false;
  return {
    task,
    assigneeName: name(task.assigneeId),
    creatorName: name(task.createdById),
    overdue: isOverdue(task, now),
    lead: lead && leadVisible ? { id: lead.id, name: lead.name, code: lead.code } : null,
    hiddenLead: Boolean(lead && !leadVisible),
    booking: booking && bookingVisible ? { id: booking.id, stage: booking.stage, unitNo: booking.unitNo, projectName: booking.projectName, leadName: booking.leadName } : null,
    hiddenBooking: Boolean(booking && !bookingVisible),
    projectName: project?.name ?? null,
    unitChanged,
    rows,
    history,
    userNames: Object.fromEntries(historyNames.map((u) => [u.id, u.name])) as Record<string, string>,
    /** Status changes. */
    canEdit: canDoTask(actor, "edit") && canAccessTask(actor, task, members),
    /** Editing fields, plan and rows (Q36: a saved proposal is Super Admin only). */
    canEditDetails: canDoTask(actor, "edit") && canAccessTask(actor, task, members) && canEditTaskDetails(actor.role, task),
  };
}
export type TaskDetail = Awaited<ReturnType<typeof getTaskDetail>>;

/** FR-092 overdue tasks for To-dos, in the actor's task scope (oldest due first), 50 per page. */
export async function overdueTasks(db: Database, actor: Actor, now = new Date(), requestedPage: unknown = 1) {
  if (!canDoTask(actor, "view")) return { count: 0, rows: [], page: 1, pageCount: 1 };
  const members = await teamMemberIds(db, actor);
  const where = and(taskScopeFilter(actor, members), overdueCondition(now));
  const [{ n }] = await db.select({ n: count() }).from(tasks).where(where);
  const { page, pageCount } = pageWithin(requestedPage, n, TASK_PAGE_SIZE);
  const rows = await db
    .select({ id: tasks.id, title: tasks.title, type: tasks.type, status: tasks.status, dueAt: tasks.dueAt, assigneeName: assignee.name })
    .from(tasks)
    .innerJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .where(where)
    .orderBy(asc(tasks.dueAt), asc(tasks.id))
    .limit(TASK_PAGE_SIZE)
    .offset((page - 1) * TASK_PAGE_SIZE);
  return { count: n, rows, page, pageCount };
}
