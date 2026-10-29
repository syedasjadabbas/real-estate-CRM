import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Database } from "@/server/db";
import { auditLogs, bookings, projects, taskHistory, taskInstallmentRows, tasks, units, users, type TaskProposal } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { canAccessBooking } from "@/modules/bookings/policy";
import { seesInactiveInSelector } from "@/modules/projects/policy";
import { loadAccessibleLead, teamMemberIds, type DbOrTx, type Tx } from "@/modules/leads/support";
import { DEFAULT_RECURRING_LABEL, TASK_STATUS_LABELS, hasPlan } from "./constants";
import { buildRows, computeFigures, unitPricePerSqft, type PlanRow, type ProposalSettings } from "./plan";
import { ASSIGNABLE_ROLES, assertCanTask, canAssignTo, canEditDownPayment, discountCap } from "./policy";
import { getProposalSettings } from "./settings";
import { loadAccessibleTask, parseTask, taskFieldError } from "./support";
import { createTaskSchema, proposalSchema, statusSchema, updateTaskSchema } from "./validation";

type ProposalData = z.output<typeof proposalSchema>;
type RowData = { label: string; description: string | null; progress: string | null; amount: number };

async function record(tx: DbOrTx, actor: Actor, taskId: string, action: string, data: Record<string, unknown>, before: unknown = null) {
  await tx.insert(taskHistory).values({ taskId, actorId: actor.id, action, data });
  await tx.insert(auditLogs).values({ actorId: actor.id, action: `task.${action}`, entity: "task", entityId: taskId, before, after: data });
}

async function checkAssignee(tx: DbOrTx, actor: Actor, assigneeId: string, members: string[]) {
  const [user] = await tx.select({ id: users.id, role: users.role, status: users.status }).from(users).where(eq(users.id, assigneeId)).limit(1);
  if (!user || user.status !== "active" || !ASSIGNABLE_ROLES.includes(user.role)) throw taskFieldError("assigneeId", "Choose an active team member");
  if (!canAssignTo(actor, assigneeId, members)) {
    throw taskFieldError("assigneeId", actor.role === "agent" ? "Agents can only assign tasks to themselves" : "You can assign to yourself or your team");
  }
}

/** Linked lead / booking must be visible to the actor; a booking linked with a lead must be that lead's booking. */
async function checkLinks(tx: DbOrTx, actor: Actor, leadId: string | null, bookingId: string | null, members: string[]) {
  if (leadId) {
    try {
      await loadAccessibleLead(tx, actor, leadId);
    } catch {
      throw taskFieldError("leadId", "Choose a lead you can access");
    }
  }
  if (bookingId) {
    const [booking] = await tx.select({ id: bookings.id, agentId: bookings.agentId, leadId: bookings.leadId }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    if (!booking || !canAccessBooking(actor, booking.agentId, members)) throw taskFieldError("bookingId", "Choose a booking you can access");
    if (leadId && booking.leadId !== leadId) throw taskFieldError("bookingId", "This booking belongs to a different lead");
  }
}

/**
 * Turns builder inputs into the stored plan. Prices come from the unit (or the default price
 * setting); the discount cap and the agents' down-payment lock are enforced here (FR-091).
 * An existing plan keeps its unit price and ROI snapshot while the unit is unchanged.
 */
async function resolveProposal(tx: DbOrTx, actor: Actor, input: ProposalData, existing: TaskProposal | null, settings: ProposalSettings): Promise<TaskProposal> {
  let projectId = input.projectId;
  let unit: typeof units.$inferSelect | undefined;
  if (input.unitId) {
    [unit] = await tx.select().from(units).where(eq(units.id, input.unitId)).limit(1);
    if (!unit) throw taskFieldError("proposal.unitId", "Choose a unit");
    if (projectId && unit.projectId !== projectId) throw taskFieldError("proposal.unitId", "This unit belongs to another project");
    projectId = unit.projectId;
  }
  if (projectId && projectId !== existing?.projectId) {
    const [project] = await tx.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project || (project.status !== "active" && !seesInactiveInSelector(actor))) throw taskFieldError("proposal.projectId", "Choose an active project");
  }

  const sameUnit = Boolean(existing && unit && existing.unitId === unit.id);
  const areaSqft = unit ? (sameUnit ? existing!.areaSqft : unit.areaSqft) : null;
  const pricePerSqft = unit ? (sameUnit ? existing!.pricePerSqft : unitPricePerSqft(unit, settings.defaultPricePerSqft)) : null;
  const roiPerSqft = existing ? existing.roiPerSqft : settings.roiPerSqft;

  const cap = discountCap(actor.role, settings);
  if (input.discountPct > cap && input.discountPct !== existing?.discountPct) {
    throw taskFieldError("proposal.discountPct", `Your discount limit is ${cap}%`);
  }
  let downPaymentPct = input.downPaymentPct ?? existing?.downPaymentPct ?? settings.downPaymentPct;
  if (!canEditDownPayment(actor.role)) {
    const locked = existing?.downPaymentPct ?? settings.downPaymentPct;
    if (input.downPaymentPct !== undefined && input.downPaymentPct !== locked) throw taskFieldError("proposal.downPaymentPct", "Agents can't change the down payment %");
    downPaymentPct = locked;
  }
  const installmentCount = input.installmentCount ?? existing?.installmentCount ?? settings.installmentCount;
  const figures = computeFigures({ areaSqft, pricePerSqft, discountPct: input.discountPct, downPaymentPct, installmentCount, roiPerSqft });

  return {
    customerName: input.customerName,
    preparedDate: input.preparedDate,
    preparedByName: input.preparedByName,
    preparedByTitle: input.preparedByTitle,
    projectId,
    printTitle: input.printTitle,
    clientName: input.clientName,
    customHeader: input.customHeader,
    unitId: unit?.id ?? null,
    unitDescription: unit ? [unit.type, unit.category, unit.bedrooms ? `${unit.bedrooms} bed` : null].filter(Boolean).join(" · ") || null : null,
    apartmentNo: unit?.unitNo ?? null,
    areaSqft,
    pricePerSqft,
    totalList: figures.totalList,
    discountPct: input.discountPct,
    afterDiscount: figures.afterDiscount,
    downPaymentPct,
    downPayment: figures.downPayment,
    installmentCount,
    eachInstallment: figures.eachInstallment,
    recurringLabel: input.recurringLabel ?? DEFAULT_RECURRING_LABEL,
    freeNightVouchers: input.freeNightVouchers ?? null,
    roiPerSqft,
    roiAnnual: figures.roiAnnual,
    bonuses: input.bonuses,
    whyActNow: input.whyActNow,
    nextSteps: input.nextSteps,
  };
}

const generatedRows = (p: TaskProposal) => buildRows(p, p.installmentCount, p.recurringLabel);

async function replaceRows(tx: Tx, taskId: string, rows: (PlanRow | RowData)[]) {
  await tx.delete(taskInstallmentRows).where(eq(taskInstallmentRows.taskId, taskId));
  if (rows.length) {
    await tx.insert(taskInstallmentRows).values(rows.map((r, i) => ({ taskId, seq: i + 1, label: r.label, description: r.description, progress: r.progress, amount: r.amount })));
  }
}

/** FR-090 create. Defaults the assignee to the creator; plan types need the builder's customer name. */
export async function createTask(db: Database, actor: Actor, input: unknown) {
  assertCanTask(actor, "create");
  const data = parseTask(createTaskSchema, input);
  return db.transaction(async (tx) => {
    const members = await teamMemberIds(tx, actor);
    const assigneeId = data.assigneeId ?? actor.id;
    await checkAssignee(tx, actor, assigneeId, members);
    await checkLinks(tx, actor, data.leadId, data.bookingId, members);

    let proposal: TaskProposal | null = null;
    if (hasPlan(data.type)) {
      if (!data.proposal) throw taskFieldError("proposal.customerName", "Customer name is required");
      proposal = await resolveProposal(tx, actor, data.proposal, null, await getProposalSettings(tx));
    }
    const [task] = await tx
      .insert(tasks)
      .values({
        title: data.title,
        type: data.type,
        dueAt: data.dueAt,
        assigneeId,
        createdById: actor.id,
        leadId: data.leadId,
        bookingId: data.bookingId,
        description: data.description,
        proposal,
      })
      .returning({ id: tasks.id });
    if (proposal) await replaceRows(tx, task.id, data.rows ?? generatedRows(proposal));
    await record(tx, actor, task.id, "create", { title: data.title, type: data.type, assigneeId, dueAt: data.dueAt, leadId: data.leadId, bookingId: data.bookingId });
    return { taskId: task.id };
  });
}

const TRACKED = ["title", "type", "dueAt", "assigneeId", "leadId", "bookingId", "description"] as const;
const same = (a: unknown, b: unknown) => (a instanceof Date || b instanceof Date ? new Date(a as Date).getTime() === new Date(b as Date).getTime() : (a ?? null) === (b ?? null));

/**
 * Edits task fields and, for plan types, the builder. Without `rows` the schedule is regenerated
 * from the figures; with `rows` the edited schedule is stored as given (FR-091 "editable rows").
 */
export async function updateTask(db: Database, actor: Actor, taskId: string, input: unknown) {
  assertCanTask(actor, "edit");
  const data = parseTask(updateTaskSchema, input);
  return db.transaction(async (tx) => {
    const { task, members } = await loadAccessibleTask(tx, actor, taskId, true);
    if (task.status === "cancelled") throw new AppError("BUSINESS_RULE", "A cancelled task can't be edited. Reopen it first.");

    const next = {
      title: data.title ?? task.title,
      type: data.type ?? task.type,
      dueAt: "dueAt" in data ? (data.dueAt ?? null) : task.dueAt,
      assigneeId: "assigneeId" in data ? (data.assigneeId ?? task.assigneeId) : task.assigneeId,
      leadId: "leadId" in data ? (data.leadId ?? null) : task.leadId,
      bookingId: "bookingId" in data ? (data.bookingId ?? null) : task.bookingId,
      description: "description" in data ? (data.description ?? null) : task.description,
    };
    if (next.assigneeId !== task.assigneeId) await checkAssignee(tx, actor, next.assigneeId, members);
    if (next.leadId !== task.leadId || next.bookingId !== task.bookingId) await checkLinks(tx, actor, next.leadId, next.bookingId, members);

    let proposal = task.proposal;
    let rows: (PlanRow | RowData)[] | null = null;
    if (!hasPlan(next.type)) {
      proposal = null;
      rows = [];
    } else if (data.proposal) {
      proposal = await resolveProposal(tx, actor, data.proposal, task.proposal, await getProposalSettings(tx));
      rows = data.rows ?? generatedRows(proposal);
    } else if (!proposal) {
      throw taskFieldError("proposal.customerName", "Customer name is required");
    } else if (data.rows) {
      rows = data.rows;
    }

    const changed = TRACKED.filter((k) => !same(next[k], task[k]));
    const planChanged = rows !== null || JSON.stringify(proposal) !== JSON.stringify(task.proposal);
    if (changed.length === 0 && !planChanged) return { changed: [] as string[] };

    await tx.update(tasks).set({ ...next, proposal, updatedAt: new Date() }).where(eq(tasks.id, task.id));
    if (rows !== null) await replaceRows(tx, task.id, rows);

    if (changed.length) {
      const before = Object.fromEntries(changed.map((k) => [k, task[k]]));
      await record(tx, actor, task.id, "update", Object.fromEntries(changed.map((k) => [k, next[k]])), before);
    }
    if (changed.includes("assigneeId")) await record(tx, actor, task.id, "assign", { from: task.assigneeId, to: next.assigneeId });
    if (planChanged && proposal) {
      await record(tx, actor, task.id, "plan", {
        discountPct: proposal.discountPct,
        downPaymentPct: proposal.downPaymentPct,
        installmentCount: proposal.installmentCount,
        afterDiscount: proposal.afterDiscount,
        rows: rows?.length ?? null,
        rowsEdited: Boolean(data.rows),
      });
    }
    return { changed: planChanged ? [...changed, "plan"] : changed };
  });
}

/** Status changes from any status to any other; Done stamps the completion time. */
export async function setTaskStatus(db: Database, actor: Actor, taskId: string, input: unknown) {
  assertCanTask(actor, "edit");
  const { status } = parseTask(statusSchema, input);
  return db.transaction(async (tx) => {
    const { task } = await loadAccessibleTask(tx, actor, taskId, true);
    if (task.status === status) return { from: task.status, to: status, changed: false };
    await tx
      .update(tasks)
      .set({ status, completedAt: status === "done" ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(tasks.id, task.id), eq(tasks.status, task.status)));
    await record(tx, actor, task.id, "status", { from: task.status, to: status, fromLabel: TASK_STATUS_LABELS[task.status], toLabel: TASK_STATUS_LABELS[status] });
    return { from: task.status, to: status, changed: true };
  });
}

/** "Rebuild installment rows": replaces edited rows with the generated schedule from the saved figures. */
export async function rebuildInstallments(db: Database, actor: Actor, taskId: string) {
  assertCanTask(actor, "edit");
  return db.transaction(async (tx) => {
    const { task } = await loadAccessibleTask(tx, actor, taskId, true);
    if (!task.proposal) throw new AppError("BUSINESS_RULE", "Only proposal and payment-plan tasks have installment rows.");
    if (task.status === "cancelled") throw new AppError("BUSINESS_RULE", "A cancelled task can't be edited. Reopen it first.");
    const rows = generatedRows(task.proposal);
    await replaceRows(tx, task.id, rows);
    await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
    await record(tx, actor, task.id, "rebuild", { rows: rows.length });
    return { rows: rows.length };
  });
}
