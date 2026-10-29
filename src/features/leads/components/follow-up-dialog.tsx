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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setMessage(null);
      const input = { dueAt: due ? fromLocalInputValue(due) : "", note };
      const result = schedule ? await schedule(input) : await scheduleFollowUpAction(leadId ?? "", input);
      if (result.ok) {
        setNote("");
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
      <Field label="Due (Pakistan time)" required error={errors.dueAt}>
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={textareaClass + " h-10"}
          />
        )}
      </Field>
      <Field label="Note" error={errors.note}>
        {(id) => (
          <textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should happen on this follow-up?" className={textareaClass} />
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
