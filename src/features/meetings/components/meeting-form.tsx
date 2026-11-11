"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { FormSection, selectClass } from "@/features/leads/components/lead-fields";
import { fromLocalInputValue } from "@/features/leads/format";
import { STAGE_LABELS } from "@/modules/leads/constants";
import { MEETING_TYPES, MEETING_TYPE_LABELS, wouldMoveLead } from "@/modules/meetings/constants";
import type { MeetingFormOptions } from "@/modules/meetings/queries";
import { createMeetingAction, updateMeetingAction } from "../actions";

export type MeetingFormInitial = {
  title: string;
  startsLocal: string;
  endsLocal: string;
  type: string;
  location: string;
  organizerId: string;
  leadId: string;
  notes: string;
};

/**
 * FR-100 schedule / edit. On create, the D2 checkbox ("Also move lead to Meeting Scheduled") is shown
 * with the lead's current stage; the server applies the same forward-only rule.
 */
export function MeetingForm({ mode, meetingId, options, initial }: { mode: "create" | "edit"; meetingId?: string; options: MeetingFormOptions; initial: MeetingFormInitial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState(initial);
  const [moveLead, setMoveLead] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (patch: Partial<typeof v>) => setV((s) => ({ ...s, ...patch }));
  const lead = options.leads.find((l) => l.id === v.leadId);
  const movable = lead ? wouldMoveLead("schedule", lead.stage) : false;

  const submit = () =>
    startTransition(async () => {
      setFormError(null);
      const payload: Record<string, unknown> = {
        title: v.title,
        startsAt: v.startsLocal ? fromLocalInputValue(v.startsLocal) : "",
        endsAt: v.endsLocal ? fromLocalInputValue(v.endsLocal) : null,
        type: v.type || undefined,
        location: v.location,
        organizerId: v.organizerId || null,
        leadId: v.leadId,
        notes: v.notes,
      };
      if (mode === "create") payload.moveLead = moveLead && movable;
      const result = mode === "create" ? await createMeetingAction(payload) : await updateMeetingAction(meetingId!, payload);
      if (result.ok) {
        const id = mode === "create" ? (result.data as { meetingId: string }).meetingId : meetingId!;
        return router.push(`/dashboard/meetings/${id}?saved=1`);
      }
      setErrors(result.fields ?? {});
      setFormError(result.message);
    });

  const text = (key: "title" | "location", label: string, required = false) => (
    <Field label={label} required={required} error={errors[key]} className={key === "title" ? "sm:col-span-2" : undefined}>
      {(id, describedBy) => (
        <Input id={id} aria-describedby={describedBy} invalid={Boolean(errors[key])} value={v[key]} maxLength={200} disabled={pending} onChange={(e) => set({ [key]: e.target.value })} />
      )}
    </Field>
  );
  const when = (key: "startsLocal" | "endsLocal", label: string, errorKey: string, required = false) => (
    <Field label={label} required={required} error={errors[errorKey]}>
      {(id, describedBy) => (
        <Input id={id} aria-describedby={describedBy} invalid={Boolean(errors[errorKey])} type="datetime-local" value={v[key]} disabled={pending} onChange={(e) => set({ [key]: e.target.value })} />
      )}
    </Field>
  );

  return (
    <form
      noValidate
      aria-label={mode === "create" ? "Schedule meeting" : "Edit meeting"}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      {formError ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {formError}
        </p>
      ) : null}
      <FormSection title="Meeting">
        {text("title", "Title", true)}
        {when("startsLocal", "Starts (Pakistan time)", "startsAt", true)}
        {when("endsLocal", "Ends (optional)", "endsAt")}
        <Field label="Meeting type" required error={errors.type}>
          {(id, describedBy) => (
            <select id={id} aria-describedby={describedBy} value={v.type} onChange={(e) => set({ type: e.target.value })} className={selectClass} disabled={pending}>
              <option value="">Select a type…</option>
              {MEETING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MEETING_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {text("location", "Location (optional)")}
        <Field label="Organizer" required error={errors.organizerId}>
          {(id, describedBy) => (
            <select id={id} aria-describedby={describedBy} value={v.organizerId} onChange={(e) => set({ organizerId: e.target.value })} className={selectClass} disabled={pending}>
              {options.organizers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Lead" required error={errors.leadId} className="sm:col-span-2">
          {(id, describedBy) => (
            <select id={id} aria-describedby={describedBy} value={v.leadId} onChange={(e) => set({ leadId: e.target.value })} className={selectClass} disabled={pending}>
              <option value="">{options.leads.length ? "Select a lead…" : "No leads in this project"}</option>
              {options.leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.code}) · {STAGE_LABELS[l.stage]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {mode === "create" && lead ? (
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-sm font-semibold text-zinc-800">
              <input type="checkbox" className="mt-0.5 size-4 accent-[#107c41]" checked={moveLead && movable} disabled={!movable || pending} onChange={(e) => setMoveLead(e.target.checked)} />
              <span>
                Also move lead to Meeting Scheduled
                <span className="block text-[11px] font-medium text-zinc-500">
                  {movable
                    ? `Currently ${STAGE_LABELS[lead.stage]}.`
                    : `Not available: the lead is ${STAGE_LABELS[lead.stage]}. Leads only move forward from New Lead, Contact Attempted, Contacted or Qualified Lead.`}
                </span>
              </span>
            </label>
          </div>
        ) : null}
        <Field label="Notes" error={errors.notes} className="sm:col-span-2">
          {(id, describedBy) => (
            <textarea id={id} aria-describedby={describedBy} rows={3} value={v.notes} onChange={(e) => set({ notes: e.target.value })} className={textareaClass} disabled={pending} />
          )}
        </Field>
      </FormSection>
      <div className="flex flex-wrap justify-end gap-2">
        <Link href={mode === "create" ? "/dashboard/meetings" : `/dashboard/meetings/${meetingId}`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Cancel
        </Link>
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="px-5">
          {pending ? "Saving…" : mode === "create" ? "Schedule meeting" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
