"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { AssignmentSettings } from "@/modules/leads/assignment-score";
import { updateAssignmentSettingsAction } from "../assignment-actions";
import { FormSection } from "./lead-fields";

type Key = keyof AssignmentSettings;
// Plain-English labels and hints (owner review, 16 Nov 2026). These settings only shape the agent
// score; they do not decide who gets a lead (that is the equal rotation).
const FIELDS: { key: Key; label: string; hint: string; section: "weights" | "rules" }[] = [
  { key: "weightWorkload", label: "Workload %", hint: "Room for more work: open leads plus follow-ups due this week, compared with the maximum load below. Less busy scores higher.", section: "weights" },
  { key: "weightPerformance", label: "Performance %", hint: "Follow-ups done on time, and new leads touched within a day.", section: "weights" },
  { key: "weightConversion", label: "Conversion %", hint: "Leads booked out of all leads that ended (booked or lost).", section: "weights" },
  { key: "weightAvailability", label: "Availability %", hint: "Signed in to the CRM right now, during working hours.", section: "weights" },
  {
    key: "maxLoad",
    label: "Maximum load per agent",
    hint: "Open leads plus pending follow-ups that count as completely full. At this number the workload part scores 0; at half of it, about 50. It lowers the score only: agents keep getting their turn in the rotation.",
    section: "rules",
  },
  {
    key: "minDecidedLeads",
    label: "Leads ended before conversion counts fully",
    hint: "A new agent with 1 booked of 1 shouldn't show 100%. Until this many of their leads are booked or lost, conversion leans toward a neutral 50%.",
    section: "rules",
  },
  { key: "minPerformanceSample", label: "Activity before performance counts fully", hint: "Follow-ups due plus new leads to touch. Until then the score is marked provisional (prov.).", section: "rules" },
  { key: "lookbackDays", label: "History window (days)", hint: "Performance and conversion look only at this many recent days, so old months don't hold an agent back.", section: "rules" },
  { key: "onlineMinutes", label: "Counts as online for (minutes)", hint: "Someone active in the CRM within this many minutes gets full availability points.", section: "rules" },
  {
    key: "offlineAvailability",
    label: "Points when not online (0 to 1)",
    hint: "Share of the availability points for someone not online, e.g. 0.3 = 30%, since they may just be on a call. 0 gives none, 1 gives full.",
    section: "rules",
  },
  { key: "workStart", label: "Working hours start (Pakistan time)", hint: "24-hour time, e.g. 09:00.", section: "rules" },
  { key: "workEnd", label: "Working hours end", hint: "24-hour time, e.g. 19:00. Outside working hours availability points are halved, so evening scores don't swing.", section: "rules" },
];

/** Weights and details behind the agent score. The four weights must add up to 100. */
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
      <FormSection title={total === 100 ? "What the score is made of · total 100%" : `What the score is made of · total ${total}% (must be 100%)`}>{FIELDS.filter((f) => f.section === "weights").map(field)}</FormSection>
      <FormSection title="Details">{FIELDS.filter((f) => f.section === "rules").map(field)}</FormSection>
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
