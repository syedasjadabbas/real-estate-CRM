"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { AssignmentSettings } from "@/modules/leads/assignment-score";
import { updateAssignmentSettingsAction } from "../assignment-actions";
import { FormSection } from "./lead-fields";

type Key = keyof AssignmentSettings;
const FIELDS: { key: Key; label: string; hint: string; section: "weights" | "rules" }[] = [
  { key: "weightWorkload", label: "Workload and capacity %", hint: "Open leads plus follow-ups due this week, against the maximum below.", section: "weights" },
  { key: "weightPerformance", label: "Performance %", hint: "Follow-ups done on time and first touch within a day.", section: "weights" },
  { key: "weightConversion", label: "Conversion %", hint: "Booked ÷ (booked + lost), steadied until there is enough history.", section: "weights" },
  { key: "weightAvailability", label: "Availability %", hint: "Signed in recently, within working hours.", section: "weights" },
  { key: "maxLoad", label: "Maximum load per agent", hint: "Open leads plus pending follow-ups at which an agent gets no more leads.", section: "rules" },
  { key: "minDecidedLeads", label: "Decided leads before conversion counts fully", hint: "Until then the score leans on a neutral 50%.", section: "rules" },
  { key: "minPerformanceSample", label: "Activity before performance counts fully", hint: "Follow-ups due plus leads to touch.", section: "rules" },
  { key: "lookbackDays", label: "History window (days)", hint: "How far back performance and conversion look.", section: "rules" },
  { key: "onlineMinutes", label: "Signed in within (minutes)", hint: "Counts as available.", section: "rules" },
  { key: "offlineAvailability", label: "Availability when not signed in (0–1)", hint: "e.g. 0.3", section: "rules" },
  { key: "workStart", label: "Working hours start (Pakistan time)", hint: "HH:MM", section: "rules" },
  { key: "workEnd", label: "Working hours end", hint: "HH:MM. Outside these hours availability is halved.", section: "rules" },
];

/** Weights and thresholds for automatic assignment. The four weights must add up to 100. */
export function AssignmentSettingsForm({ settings }: { settings: AssignmentSettings }) {
  const [v, setV] = useState<Record<Key, string>>(Object.fromEntries(Object.entries(settings).map(([k, x]) => [k, String(x)])) as Record<Key, string>);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const total = ["weightWorkload", "weightPerformance", "weightConversion", "weightAvailability"].reduce((a, k) => a + (Number(v[k as Key]) || 0), 0);
  const field = (f: (typeof FIELDS)[number]) => (
    <Field key={f.key} label={f.label} hint={f.hint} error={errors[f.key]}>
      {(id, d) => <Input id={id} aria-describedby={d} invalid={Boolean(errors[f.key])} value={v[f.key]} disabled={pending} onChange={(e) => setV((s) => ({ ...s, [f.key]: e.target.value }))} />}
    </Field>
  );
  return (
    <form
      noValidate
      aria-label="Assignment settings"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await updateAssignmentSettingsAction(v);
          if (r.ok) {
            setErrors({});
            setMsg({ text: "Assignment settings saved.", ok: true });
          } else {
            setErrors(r.fields ?? {});
            setMsg({ text: r.message, ok: false });
          }
        });
      }}
    >
      <FormSection title={`Weights · total ${total}%`}>{FIELDS.filter((f) => f.section === "weights").map(field)}</FormSection>
      <FormSection title="Rules">{FIELDS.filter((f) => f.section === "rules").map(field)}</FormSection>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? (
          <p role="status" className={cn("text-xs font-semibold", msg.ok ? "text-emerald-700" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
