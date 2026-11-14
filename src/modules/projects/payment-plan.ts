import type { ProjectPaymentPlan } from "@/server/db/schema";

/** A project's payment plan with every part filled in. */
export type PaymentPlan = Required<ProjectPaymentPlan>;

/**
 * The plan a booking uses (owner, 14 Nov 2026): the project's own, with any missing part taken from the
 * standard plan (down payment % and installments from Tasks settings; monthly; no possession amount
 * or balloons unless the project sets them).
 */
export function resolvePaymentPlan(project: ProjectPaymentPlan | null | undefined, standard: { downPaymentPct: number; installmentCount: number }): PaymentPlan {
  const p = project ?? {};
  return {
    downPaymentPct: p.downPaymentPct ?? standard.downPaymentPct,
    installmentCount: p.installmentCount ?? standard.installmentCount,
    everyMonths: p.everyMonths ?? 1,
    possessionPct: p.possessionPct ?? 0,
    balloonCount: p.balloonCount ?? 0,
    balloonPct: p.balloonPct ?? 0,
  };
}

/** One-line summary, e.g. "35% down · 36 monthly installments · 10% on possession". */
export function planSummary(plan: PaymentPlan) {
  const every = plan.everyMonths === 1 ? "monthly" : plan.everyMonths === 3 ? "quarterly" : `every ${plan.everyMonths} months`;
  return [
    `${plan.downPaymentPct}% down`,
    `${plan.installmentCount} ${every} installments`,
    plan.balloonCount ? `${plan.balloonCount} balloons of ${plan.balloonPct}%` : null,
    plan.possessionPct ? `${plan.possessionPct}% on possession` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
