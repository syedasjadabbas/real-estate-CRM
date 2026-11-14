"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { ActionResult } from "@/server/errors";
import { scheduleFollowUpAction } from "../actions";
import { fromLocalInputValue, toLocalInputValue } from "../format";

export const textareaClass =
  "w-full rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-2 text-sm font-medium text-zinc-900 shadow-hairline placeholder:text-zinc-400 focus:border-brand/50 focus:bg-white focus:ring-2 focus:ring-brand/15 focus:outline-none";

type ScheduleInput = { dueAt: string; note?: string };

/** Quick due times (owner, 14 Nov 2026); "Pick a date and time" keeps the picker below. */
const WHEN = [
  { label: "In 1 hour", hours: 1 },
  { label: "In 3 hours", hours: 3 },
  { label: "Tomorrow", hours: 24 },
  { label: "In 2 days", hours: 48 },
  { label: "In 3 days", hours: 72 },
  { label: "Next week", hours: 168 },
] as const;

/** Common follow-up purposes; the comment box stays for anything else, or for details. */
export const FOLLOW_UP_SUGGESTIONS = [
  "Call back",
  "Send project details / brochure",
  "Share price list and payment plan",
  "Arrange a site visit",
  "Confirm the meeting",
  "Discuss token / payment",
  "Collect documents",
  "Ask for their decision",
] as const;

const selectClass = textareaClassFor("h-10");
function textareaClassFor(extra: string) {
  return `w-full rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 text-sm font-medium text-zinc-900 shadow-hairline focus:border-brand/50 focus:bg-white focus:ring-2 focus:ring-brand/15 focus:outline-none ${extra}`;
}

/** Schedule a follow-up (date-time in Pakistan time + optional note). Clients pass their own `schedule` action. */
export function FollowUpForm({
  leadId,
  onDone,
  schedule,
}: {
  leadId?: string;
  onDone?: () => void;
  schedule?: (input: ScheduleInput) => Promise<ActionResult<unknown>>;
}) {
  const [due, setDue] = useState(() => toLocalInputValue(new Date(Date.now() + 24 * 3_600_000)));
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("Tomorrow");
  const [purpose, setPurpose] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setMessage(null);
      // The chosen purpose leads the note; a typed comment follows it.
      const comment = note.trim();
      const fullNote = purpose ? (comment ? `${purpose}: ${comment}` : purpose) : comment;
      const input = { dueAt: due ? fromLocalInputValue(due) : "", note: fullNote };
      const result = schedule ? await schedule(input) : await scheduleFollowUpAction(leadId ?? "", input);
      if (result.ok) {
        setNote("");
        setPurpose("");
        setErrors({});
        setMessage("Follow-up scheduled.");
        onDone?.();
      } else {
        setErrors(result.fields ?? {});
        setMessage(result.fields ? null : result.message);
      }
    });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="When">
          {(id) => (
            <select
              id={id}
              value={when}
              onChange={(e) => {
                setWhen(e.target.value);
                const pick = WHEN.find((w) => w.label === e.target.value);
                if (pick) setDue(toLocalInputValue(new Date(Date.now() + pick.hours * 3_600_000)));
              }}
              className={selectClass}
            >
              {WHEN.map((w) => (
                <option key={w.label} value={w.label}>
                  {w.label}
                </option>
              ))}
              <option value="custom">Pick a date and time</option>
            </select>
          )}
        </Field>
        <Field label="Due (Pakistan time)" required error={errors.dueAt}>
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              type="datetime-local"
              value={due}
              onChange={(e) => {
                setDue(e.target.value);
                setWhen("custom");
              }}
              className={textareaClass + " h-10"}
            />
          )}
        </Field>
      </div>
      <Field label="Follow-up for">
        {(id) => (
          <select id={id} value={purpose} onChange={(e) => setPurpose(e.target.value)} className={selectClass}>
            <option value="">Choose a suggestion (optional)</option>
            {FOLLOW_UP_SUGGESTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Comment" error={errors.note} hint={purpose ? `Saved as "${purpose}: …"` : "Write your own, or add details to the suggestion"}>
        {(id, describedBy) => (
          <textarea id={id} aria-describedby={describedBy} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Asked to call after 6 PM" className={textareaClass} />
        )}
      </Field>
      {message ? (
        <p role="status" className="text-xs font-semibold text-zinc-600">
          {message}
        </p>
      ) : null}
      <Button variant="primary" size="lg" onClick={submit} disabled={pending}>
        {pending ? "Scheduling…" : "Schedule follow-up"}
      </Button>
    </div>
  );
}

export function FollowUpDialog({ open, onClose, leadId, leadName }: { open: boolean; onClose: () => void; leadId: string; leadName: string }) {
  return (
    <Modal open={open} onClose={onClose} title="Schedule follow-up" description={leadName}>
      <FollowUpForm leadId={leadId} onDone={onClose} />
    </Modal>
  );
}
