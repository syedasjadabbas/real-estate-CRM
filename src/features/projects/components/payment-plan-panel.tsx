"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { selectClass } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import { planSummary, type PaymentPlan } from "@/modules/projects/payment-plan";
import { updateProjectPaymentPlanAction } from "../actions";

/**
 * The project's payment plan (owner, 14 Nov 2026): down payment %, installments and how often, balloon
 * payments and the possession amount. New booking and the booking form use it for this project's units.
 */
export function PaymentPlanPanel({ projectId, plan, canManage }: { projectId: string; plan: PaymentPlan; canManage: boolean }) {
  const toText = (p: PaymentPlan) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) as Record<keyof PaymentPlan, string>;
  const [v, setV] = useState(() => toText(plan));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof PaymentPlan, value: string) => setV((s) => ({ ...s, [k]: value }));

  if (!canManage) return <p className="text-sm font-semibold text-zinc-800">{planSummary(plan)}</p>;

  const num = (k: keyof PaymentPlan, label: string, suffix?: string, hint?: string) => (
    <Field label={label} error={errors[k]} hint={hint}>
      {(id, d) => (
        <div className="flex items-center gap-2">
          <Input id={id} aria-describedby={d} inputMode="decimal" invalid={Boolean(errors[k])} value={v[k]} onChange={(e) => set(k, e.target.value)} disabled={pending} className="w-28" />
          {suffix ? <span className="text-xs text-zinc-500">{suffix}</span> : null}
        </div>
      )}
    </Field>
  );

  return (
    <form
      noValidate
      aria-label="Payment plan"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await updateProjectPaymentPlanAction(projectId, v);
          if (r.ok) {
            setErrors({});
            setMsg({ text: r.data.changed ? "Payment plan saved." : "No changes.", ok: true });
          } else {
            setErrors(r.fields ?? {});
            setMsg({ text: r.message, ok: false });
          }
        });
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {num("downPaymentPct", "Down payment", "% of the price")}
        {num("installmentCount", "Number of installments")}
        <Field label="Installments every" error={errors.everyMonths}>
          {(id) => (
            <select id={id} value={v.everyMonths} onChange={(e) => set("everyMonths", e.target.value)} className={selectClass} disabled={pending}>
              <option value="1">Month</option>
              <option value="3">3 months (quarterly)</option>
              <option value="6">6 months</option>
            </select>
          )}
        </Field>
        {num("possessionPct", "On possession", "% of the price", "0 if nothing is due on possession")}
        {num("balloonCount", "Balloon payments", "how many", "0 for none")}
        {num("balloonPct", "Each balloon", "% of the price")}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? <p className={cn("mr-auto text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>{msg.text}</p> : null}
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save payment plan"}
        </Button>
      </div>
    </form>
  );
}
