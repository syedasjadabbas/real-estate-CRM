"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { AssignmentSettings } from "@/modules/leads/assignment-score";
import { updateAssignmentSettingsAction } from "../assignment-actions";
import { FormSection } from "./lead-fields";

type Key = keyof AssignmentSettings;
// Plain-English labels and hints (owner review, 16 Nov 2026). The agent score (leads/assignment-score.ts
// agentScore) uses ONLY follow-up performance and conversion, weighted against each other, over the history
// window. The other settings are saved but don't change anything today, and the form says so.
const FIELDS: { key: Key; label: string; hint: string; used: boolean }[] = [
  { key: "weightPerformance", label: "Performance %", hint: "Follow-ups done on time, and new leads touched within a day.", used: true },
  { key: "weightConversion", label: "Conversion %", hint: "Leads booked out of all leads that ended (booked or lost).", used: true },
  {
    key: "minDecidedLeads",
    label: "Leads ended before conversion counts fully",
    hint: "A new agent with 1 booked of 1 shouldn't show 100%. Until this many of their leads are booked or lost, conversion leans toward a neutral 50%.",
    used: true,
  },
  { key: "minPerformanceSample", label: "Activity before performance counts fully", hint: "Follow-ups due plus new leads to touch. Until then the score is marked provisional (prov.).", used: true },
  { key: "lookbackDays", label: "History window (days)", hint: "Performance and conversion look only at this many recent days, so old months don't hold an agent back.", used: true },
  { key: "weightWorkload", label: "Workload %", hint: "Kept for a possible workload part of the score; not counted today.", used: false },
  { key: "weightAvailability", label: "Availability %", hint: "Kept for a possible availability part of the score; not counted today.", used: false },
  { key: "maxLoad", label: "Maximum load per agent", hint: "Not counted today, and never stops an agent getting their turn in the rotation.", used: false },
  { key: "onlineMinutes", label: "Counts as online for (minutes)", hint: "Not counted in the score today.", used: false },
  { key: "offlineAvailability", label: "Points when not online (0 to 1)", hint: "Not counted in the score today.", used: false },
  { key: "workStart", label: "Working hours start (Pakistan time)", hint: "24-hour time, e.g. 09:00. Not counted in the score today.", used: false },
  { key: "workEnd", label: "Working hours end", hint: "24-hour time, e.g. 19:00. Not counted in the score today.", used: false },
];

/** Settings behind the agent score: the ones it uses first, then those saved but not used today. */
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
      <FormSection title="Used in the score">{FIELDS.filter((f) => f.used).map(field)}</FormSection>
      <p className={cn("text-xs", total === 100 ? "text-zinc-600" : "font-semibold text-rose-600")}>
        Only Performance and Conversion count, measured against each other: with 30 and 20, performance makes up 60% of the score and conversion 40%. All four % weights
        must still add up to 100 to save{total === 100 ? "." : ` (now ${total}%).`}
      </p>
      <FormSection title="Saved, but not used in the score today">{FIELDS.filter((f) => !f.used).map(field)}</FormSection>
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
