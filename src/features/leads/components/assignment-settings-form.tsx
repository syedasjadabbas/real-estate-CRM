"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { AssignmentSettings } from "@/modules/leads/assignment-score";
import { updateAssignmentSettingsAction } from "../assignment-actions";
import { FormSection } from "./lead-fields";

type Key = keyof AssignmentSettings;
type Fld = { key: Key; label: string; hint: string };
// Every part of the score is a setting (owner, 24 Nov 2026). Settings no longer used are kept but not shown.
const WEIGHTS: Fld[] = [
  { key: "weightPerformance", label: "Performance weight", hint: "Follow-ups completed, and new leads contacted in time." },
  { key: "weightConversion", label: "Conversion weight", hint: "Leads booked out of all leads that ended (booked or lost)." },
  { key: "weightCalls", label: "Calls weight", hint: "Calls compared with the calls goal. 0 = not counted." },
  { key: "weightMeetings", label: "Meetings weight", hint: "Completed meetings compared with the meetings goal. 0 = not counted." },
  { key: "weightSqft", label: "Sold sq ft weight", hint: "Closed Won sq ft compared with the sq ft goal. 0 = not counted." },
];
const GROUPS: { title: string; fields: Fld[] }[] = [
  {
    title: "How performance is measured",
    fields: [
      { key: "followUpShare", label: "Follow-ups share (%)", hint: "The rest of performance is contacting new leads in time. 50 = equal." },
      { key: "firstTouchHours", label: "Contact new leads within (hours)", hint: "A lead first contacted within this time counts as on time." },
    ],
  },
  {
    title: "Goals for the history window",
    fields: [
      { key: "goalCalls", label: "Calls goal", hint: "Calls in the whole window that earn full marks." },
      { key: "goalMeetings", label: "Meetings goal", hint: "Completed meetings in the window that earn full marks." },
      { key: "goalSqft", label: "Sold sq ft goal", hint: "Sq ft sold in the window that earns full marks." },
    ],
  },
  {
    title: "History and new agents",
    fields: [
      { key: "lookbackDays", label: "History window (days)", hint: "Only this many recent days count (7 to 730)." },
      { key: "minDecidedLeads", label: "Leads ended before conversion counts fully", hint: "Until then conversion leans toward the starting score." },
      { key: "minPerformanceSample", label: "Activity before performance counts fully", hint: "Follow-ups due plus new leads to contact. Until then the score is provisional." },
      { key: "neutralScore", label: "Starting score", hint: "Where an agent with no history starts, 0 to 100." },
    ],
  },
];

/** Settings behind the agent score. */
export function AssignmentSettingsForm({ settings, canEdit }: { settings: AssignmentSettings; canEdit: boolean }) {
  const [v, setV] = useState<Record<Key, string>>(Object.fromEntries(Object.entries(settings).map(([k, x]) => [k, String(x)])) as Record<Key, string>);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const total = WEIGHTS.reduce((a, f) => a + (Number(v[f.key]) || 0), 0);
  const field = (f: Fld) => (
    <Field key={f.key} label={f.label} hint={f.hint} error={errors[f.key]}>
      {(id, d) => <Input id={id} aria-describedby={d} invalid={Boolean(errors[f.key])} value={v[f.key]} disabled={pending || !canEdit} onChange={(e) => setV((s) => ({ ...s, [f.key]: e.target.value }))} />}
    </Field>
  );
  return (
    <form
      noValidate
      aria-label="Agent score settings"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await updateAssignmentSettingsAction(v);
          if (r.ok) {
            setErrors({});
            setMsg({ text: "Score settings saved. Scores update straight away.", ok: true });
          } else {
            setErrors(r.fields ?? {});
            setMsg({ text: r.message, ok: false });
          }
        });
      }}
    >
      <FormSection title="What the score is made of">{WEIGHTS.map(field)}</FormSection>
      <p className={cn("text-xs", total > 0 ? "text-zinc-600" : "font-semibold text-rose-600")}>
        {total > 0
          ? `Right now the score is: ${WEIGHTS.filter((f) => Number(v[f.key]) > 0).map((f) => `${f.label.replace(" weight", "")} ${Math.round((Number(v[f.key]) / total) * 100)}%`).join(", ")}. Weights are compared with each other, so they don't have to total 100.`
          : "Give at least one part a weight above 0."}
      </p>
      {GROUPS.map((g) => (
        <FormSection key={g.title} title={g.title}>
          {g.fields.map(field)}
        </FormSection>
      ))}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? (
          <p role="status" className={cn("text-xs font-semibold", msg.ok ? "text-emerald-700" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
        {canEdit ? (
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        ) : (
          <p className="text-xs text-zinc-600">Only the Super Admin can change these settings.</p>
        )}
      </div>
    </form>
  );
}
