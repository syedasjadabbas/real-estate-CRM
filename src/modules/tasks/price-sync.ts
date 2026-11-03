import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, taskHistory, taskInstallmentRows, tasks, units, type TaskProposal } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { buildRows, computeFigures, unitPricePerSqft } from "./plan";
import { getProposalSettings } from "./settings";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const rowKey = (r: { label: string; description: string | null; progress: string | null; amount: number; dueOn: string | null }) =>
  JSON.stringify([r.label, r.description ?? null, r.progress ?? null, Number(r.amount), r.dueOn ?? null]);

/**
 * Questionnaire Q47: saved proposals reflect later unit price changes. Called inside the unit
 * update transaction whenever a unit's price or area changes.
 *
 * Every Proposal task on the unit that is not cancelled is recalculated with the unit's current
 * price and area. Its discount %, down payment %, installment count and ROI rate stay as saved.
 * - A schedule that was generated is regenerated.
 * - A hand-edited schedule is kept as it is (it may no longer add up; the page already warns).
 * - Each change is recorded in the task history and the audit log with the previous and new figures,
 *   so the original quote is never lost.
 * Payment-plan tasks for bookings are not touched: a booking has its own agreed rate.
 */
export async function syncProposalsForUnit(tx: Tx, actor: Actor, unitId: string) {
  const [unit] = await tx.select({ areaSqft: units.areaSqft, basePrice: units.basePrice }).from(units).where(eq(units.id, unitId));
  if (!unit) return { updated: 0 };
  const settings = await getProposalSettings(tx);
  const pricePerSqft = unitPricePerSqft(unit, settings.defaultPricePerSqft);
  const linked = await tx
    .select({ id: tasks.id, proposal: tasks.proposal })
    .from(tasks)
    .where(and(eq(tasks.type, "proposal"), ne(tasks.status, "cancelled"), sql`${tasks.proposal}->>'unitId' = ${unitId}`))
    .orderBy(asc(tasks.createdAt))
    .for("update");

  let updated = 0;
  for (const task of linked) {
    const old = task.proposal as TaskProposal;
    if (old.pricePerSqft === pricePerSqft && old.areaSqft === unit.areaSqft) continue;
    const figures = computeFigures({
      areaSqft: unit.areaSqft,
      pricePerSqft,
      discountPct: old.discountPct,
      downPaymentPct: old.downPaymentPct,
      installmentCount: old.installmentCount,
      roiPerSqft: old.roiPerSqft,
    });
    const next: TaskProposal = { ...old, areaSqft: unit.areaSqft, pricePerSqft, ...figures };

    const stored = await tx
      .select({ label: taskInstallmentRows.label, description: taskInstallmentRows.description, progress: taskInstallmentRows.progress, amount: taskInstallmentRows.amount, dueOn: taskInstallmentRows.dueOn })
      .from(taskInstallmentRows)
      .where(eq(taskInstallmentRows.taskId, task.id))
      .orderBy(asc(taskInstallmentRows.seq));
    const generatedBefore = buildRows(old, old.installmentCount, old.recurringLabel, old.firstInstallmentMonth ?? null);
    const handEdited = stored.length > 0 && JSON.stringify(stored.map(rowKey)) !== JSON.stringify(generatedBefore.map(rowKey));
    if (!handEdited) {
      const rows = buildRows(next, next.installmentCount, next.recurringLabel, next.firstInstallmentMonth ?? null);
      await tx.delete(taskInstallmentRows).where(eq(taskInstallmentRows.taskId, task.id));
      if (rows.length) {
        await tx.insert(taskInstallmentRows).values(rows.map((r, i) => ({ taskId: task.id, seq: i + 1, label: r.label, description: r.description, progress: r.progress, amount: r.amount, dueOn: r.dueOn })));
      }
    }
    await tx.update(tasks).set({ proposal: next, updatedAt: new Date() }).where(eq(tasks.id, task.id));

    const before = { pricePerSqft: old.pricePerSqft, areaSqft: old.areaSqft, totalList: old.totalList, afterDiscount: old.afterDiscount, downPayment: old.downPayment, eachInstallment: old.eachInstallment };
    const after = { pricePerSqft, areaSqft: unit.areaSqft, totalList: next.totalList, afterDiscount: next.afterDiscount, downPayment: next.downPayment, eachInstallment: next.eachInstallment };
    const data = { unitId, before, after, rowsRegenerated: !handEdited };
    await tx.insert(taskHistory).values({ taskId: task.id, actorId: actor.id, action: "price_sync", data });
    await tx.insert(auditLogs).values({ actorId: actor.id, action: "task.price_sync", entity: "task", entityId: task.id, before, after: data });
    updated++;
  }
  return { updated };
}
