"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { FormSection } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import type { ProposalSettings } from "@/modules/tasks/plan";
import { updateProposalSettingsAction } from "../actions";

const FIELDS: { key: keyof ProposalSettings; label: string; hint: string; optional?: boolean }[] = [
  { key: "agentCap", label: "Agent discount cap %", hint: "Agents can't discount above this (5%, confirmed by the client)." },
  { key: "managerCap", label: "Manager discount cap %", hint: "5%, confirmed by the client. Blank: managers use the agent cap.", optional: true },
  { key: "downPaymentPct", label: "Down payment %", hint: "Default for new proposals. Agents can't change it." },
  { key: "installmentCount", label: "No. of installments", hint: "Default for new proposals." },
  { key: "defaultPricePerSqft", label: "Default price / sq ft (PKR)", hint: "Used when a unit has no list price and no floor rate applies. Blank: not set.", optional: true },
  { key: "roiPerSqft", label: "ROI per sq ft per year (PKR)", hint: "Expected ROI = area × this. Blank: ROI not shown.", optional: true },
  { key: "floorPriceGF", label: "Ground floor (GF) price / sq ft (PKR)", hint: "Used when a ground-floor unit has no list price. Client rate: 10,824. Blank: not set.", optional: true },
  { key: "floorPriceFF", label: "First floor (FF) price / sq ft (PKR)", hint: "Used when a first-floor unit has no list price. Client rate: 9,593. Blank: not set.", optional: true },
  { key: "floorPriceSF", label: "Second floor (SF) price / sq ft (PKR)", hint: "Used when a second-floor unit has no list price. Client rate: 8,624. Blank: not set.", optional: true },
];

/** FR-009 proposal settings. Defaults confirmed by the client on 10 Nov 2026 (caps 5%, down payment 25%, floor rates). */
export function ProposalSettingsForm({ initial, canEdit }: { initial: ProposalSettings; canEdit: boolean }) {
  const [values, setValues] = useState(() => Object.fromEntries(FIELDS.map((f) => [f.key, initial[f.key] === null ? "" : String(initial[f.key])])) as Record<keyof ProposalSettings, string>);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      noValidate
      aria-label="Proposal settings"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await updateProposalSettingsAction(values);
          if (result.ok) {
            setErrors({});
            setMsg({ text: result.data.changed.length ? "Settings saved. They apply to proposals saved from now on." : "No changes to save.", ok: true });
          } else {
            setErrors(result.fields ?? {});
            setMsg({ text: result.message, ok: false });
          }
        });
      }}
      className="space-y-4"
    >
      <FormSection title="Proposal defaults">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint} error={errors[f.key]}>
            {(id, describedBy) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={Boolean(errors[f.key])}
                inputMode="decimal"
                value={values[f.key]}
                placeholder={f.optional ? "Not set" : undefined}
                disabled={!canEdit || pending}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            )}
          </Field>
        ))}
      </FormSection>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
        {canEdit ? (
          <Button type="submit" variant="primary" size="lg" disabled={pending} className="px-5">
            {pending ? "Saving…" : "Save settings"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
