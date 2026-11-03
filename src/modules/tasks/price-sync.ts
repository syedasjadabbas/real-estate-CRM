import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, taskHistory, taskInstallmentRows, tasks, units, type TaskProposal } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { buildRows, computeFigures, unitPricePerSqft, type ProposalSettings } from "./plan";
import { canDoTask } from "./policy";
import { getProposalSettings } from "./settings";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbOrTx = Database | Tx;
type Unit = { areaSqft: number; basePrice: number };
type ProposalTask = { id: string; type: string; status: string; title: string; proposal: TaskProposal | null };

const rowKey = (r: { label: string; description: string | null; progress: string | null; amount: number; dueOn: string | null }) =>
  JSON.stringify([r.label, r.description ?? null, r.progress ?? null, Number(r.amount), r.dueOn ?? null]);

async function storedRows(db: DbOrTx, taskId: string) {
  return db
    .select({ label: taskInstallmentRows.label, description: taskInstallmentRows.description, progress: taskInstallmentRows.progress, amount: taskInstallmentRows.amount, dueOn: taskInstallmentRows.dueOn })
    .from(taskInstallmentRows)
    .where(eq(taskInstallmentRows.taskId, taskId))
    .orderBy(asc(taskInstallmentRows.seq));
}

/** Rows that differ from what the saved figures would generate were edited by hand: they are never overwritten. */
function isHandEdited(stored: Awaited<ReturnType<typeof storedRows>>, old: TaskProposal) {
  const generated = buildRows(old, old.installmentCount, old.recurringLabel, old.firstInstallmentMonth ?? null);
  return stored.length > 0 && JSON.stringify(stored.map(rowKey)) !== JSON.stringify(generated.map(rowKey));
}

/** The figures a proposal would have at the unit's current price (discount %, down payment %, count and ROI kept). */
function recalculated(old: TaskProposal, unit: Unit, settings: Pick<ProposalSettings, "defaultPricePerSqft">): TaskProposal {
  const pricePerSqft = unitPricePerSqft(unit, settings.defaultPricePerSqft);
  const figures = computeFigures({ areaSqft: unit.areaSqft, pricePerSqft, discountPct: old.discountPct, downPaymentPct: old.downPaymentPct, installmentCount: old.installmentCount, roiPerSqft: old.roiPerSqft });
  return { ...old, areaSqft: unit.areaSqft, pricePerSqft, ...figures };
}

const differs = (old: TaskProposal, next: TaskProposal) => old.pricePerSqft !== next.pricePerSqft || old.areaSqft !== next.areaSqft;
const snapshot = (p: TaskProposal) => ({ pricePerSqft: p.pricePerSqft, areaSqft: p.areaSqft, totalList: p.totalList, afterDiscount: p.afterDiscount, downPayment: p.downPayment, eachInstallment: p.eachInstallment });

/**
 * Applies the current unit figures to one proposal: generated schedules are regenerated, hand-edited
 * ones kept; the previous and new figures go to the task history and audit log.
 */
async function applyToProposal(tx: Tx, actor: Actor, task: { id: string; proposal: TaskProposal }, unit: Unit, settings: ProposalSettings, trigger: "unit_update" | "reconciliation") {
  const old = task.proposal;
  const next = recalculated(old, unit, settings);
  if (!differs(old, next)) return false;
  const handEdited = isHandEdited(await storedRows(tx, task.id), old);
  if (!handEdited) {
    const rows = buildRows(next, next.installmentCount, next.recurringLabel, next.firstInstallmentMonth ?? null);
    await tx.delete(taskInstallmentRows).where(eq(taskInstallmentRows.taskId, task.id));
    if (rows.length) await tx.insert(taskInstallmentRows).values(rows.map((r, i) => ({ taskId: task.id, seq: i + 1, label: r.label, description: r.description, progress: r.progress, amount: r.amount, dueOn: r.dueOn })));
  }
  await tx.update(tasks).set({ proposal: next, updatedAt: new Date() }).where(eq(tasks.id, task.id));
  const before = snapshot(old);
  const data = { unitId: old.unitId, trigger, before, after: snapshot(next), rowsRegenerated: !handEdited };
  await tx.insert(taskHistory).values({ taskId: task.id, actorId: actor.id, action: "price_sync", data });
  await tx.insert(auditLogs).values({ actorId: actor.id, action: "task.price_sync", entity: "task", entityId: task.id, before, after: data });
  return true;
}

/**
 * Questionnaire Q47: saved proposals reflect later unit price changes. Called inside the unit
 * update transaction whenever a unit's price or area changes. Only Proposal tasks that are not
 * cancelled are touched; booking payment plans keep their agreed rate.
 */
export async function syncProposalsForUnit(tx: Tx, actor: Actor, unitId: string) {
  const [unit] = await tx.select({ areaSqft: units.areaSqft, basePrice: units.basePrice }).from(units).where(eq(units.id, unitId));
  if (!unit) return { updated: 0 };
  const settings = await getProposalSettings(tx);
  const linked = await tx
    .select({ id: tasks.id, proposal: tasks.proposal })
    .from(tasks)
    .where(and(eq(tasks.type, "proposal"), sql`${tasks.status} <> 'cancelled'`, sql`${tasks.proposal}->>'unitId' = ${unitId}`))
    .orderBy(asc(tasks.createdAt))
    .for("update");
  let updated = 0;
  for (const task of linked) if (await applyToProposal(tx, actor, { id: task.id, proposal: task.proposal! }, unit, settings, "unit_update")) updated++;
  return { updated };
}

// ─── Reconciliation of proposals saved before automatic sync ─────────────────

export type ReconciliationAction = "update" | "update_keep_rows" | "skip_cancelled" | "skip_payment_plan";
export const RECONCILIATION_LABELS: Record<ReconciliationAction, string> = {
  update: "Recalculate figures and regenerate the schedule",
  update_keep_rows: "Recalculate figures; keep the hand-edited schedule",
  skip_cancelled: "Not changed: cancelled",
  skip_payment_plan: "Not changed: booking payment plan",
};

/**
 * Report (dry run): every saved plan whose stored unit price or area differs from its unit's
 * current figures, with what applying would do. Nothing is written.
 */
export async function proposalReconciliationReport(db: DbOrTx, actor: Actor) {
  if (!canDoTask(actor, "settings")) throw forbidden();
  const settings = await getProposalSettings(db);
  const planned = (await db
    .select({ id: tasks.id, type: tasks.type, status: tasks.status, title: tasks.title, proposal: tasks.proposal })
    .from(tasks)
    .where(and(inArray(tasks.type, ["proposal", "payment_plan"]), sql`${tasks.proposal}->>'unitId' is not null`))
    .orderBy(asc(tasks.createdAt))) as ProposalTask[];
  const unitIds = [...new Set(planned.map((t) => t.proposal!.unitId!))];
  const unitRows = unitIds.length ? await db.select({ id: units.id, unitNo: units.unitNo, areaSqft: units.areaSqft, basePrice: units.basePrice }).from(units).where(inArray(units.id, unitIds)) : [];
  const rows: {
    taskId: string;
    title: string;
    customerName: string;
    unitNo: string;
    action: ReconciliationAction;
    saved: ReturnType<typeof snapshot>;
    current: ReturnType<typeof snapshot>;
  }[] = [];
  for (const t of planned) {
    const unit = unitRows.find((u) => u.id === t.proposal!.unitId);
    if (!unit) continue;
    const next = recalculated(t.proposal!, unit, settings);
    if (!differs(t.proposal!, next)) continue;
    const action: ReconciliationAction =
      t.type === "payment_plan" ? "skip_payment_plan" : t.status === "cancelled" ? "skip_cancelled" : isHandEdited(await storedRows(db, t.id), t.proposal!) ? "update_keep_rows" : "update";
    rows.push({ taskId: t.id, title: t.title, customerName: t.proposal!.customerName, unitNo: unit.unitNo, action, saved: snapshot(t.proposal!), current: snapshot(next) });
  }
  const count = (a: ReconciliationAction) => rows.filter((r) => r.action === a).length;
  return { rows, summary: { update: count("update"), updateKeepRows: count("update_keep_rows"), skipCancelled: count("skip_cancelled"), skipPaymentPlan: count("skip_payment_plan") } };
}

/**
 * Applies the reconciliation to the reported proposals (Admin / Super Admin, deliberately, never as a
 * deployment step). Idempotent: an applied proposal no longer differs, so a second run changes nothing.
 * Cancelled proposals and payment plans are never changed.
 */
export async function applyProposalReconciliation(db: Database, actor: Actor) {
  if (!canDoTask(actor, "settings")) throw forbidden();
  return db.transaction(async (tx) => {
    const report = await proposalReconciliationReport(tx, actor);
    const settings = await getProposalSettings(tx);
    let updated = 0;
    for (const r of report.rows.filter((x) => x.action === "update" || x.action === "update_keep_rows")) {
      const [task] = await tx.select({ id: tasks.id, status: tasks.status, type: tasks.type, proposal: tasks.proposal }).from(tasks).where(eq(tasks.id, r.taskId)).for("update");
      if (!task?.proposal || task.type !== "proposal" || task.status === "cancelled") continue;
      const [unit] = await tx.select({ areaSqft: units.areaSqft, basePrice: units.basePrice }).from(units).where(eq(units.id, task.proposal.unitId!));
      if (unit && (await applyToProposal(tx, actor, { id: task.id, proposal: task.proposal }, unit, settings, "reconciliation"))) updated++;
    }
    await tx.insert(auditLogs).values({ actorId: actor.id, action: "task.price_reconciliation", entity: "task", entityId: null, before: null, after: { updated, ...report.summary } });
    return { updated, ...report.summary };
  });
}
