"use client";

import { RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { OPEN_STAGES, STAGE_LABELS, type LeadStage } from "@/modules/leads/constants";
import { changeStageAction } from "../actions";
import { textareaClass } from "./follow-up-dialog";
import { selectClass } from "./lead-fields";

/** A Lost lead's way back (client, 24 Nov 2026): the agent chooses the stage it returns to and says why. */
export function ReopenLead({ leadId, leadName, lastStage }: { leadId: string; leadName: string; lastStage: LeadStage }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<LeadStage>(lastStage);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = () =>
    startTransition(async () => {
      const result = await changeStageAction(leadId, stage, remarks);
      if (result.ok) setOpen(false);
      else setError(result.message);
    });
  return (
    <>
      <Button variant="primary" size="lg" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden="true" className="size-4" />
        Reopen lead
      </Button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title="Reopen lead" description={leadName}>
          <form
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field label="Reopen at stage" hint={stage === lastStage ? "Where it was before it was lost" : undefined}>
              {(id, d) => (
                <select id={id} aria-describedby={d} value={stage} onChange={(e) => setStage(e.target.value as LeadStage)} className={selectClass} disabled={pending}>
                  {OPEN_STAGES.filter((s) => s !== "booking_in_process").map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Why">
              {(id) => (
                <textarea
                  id={id}
                  rows={2}
                  maxLength={1000}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. Enquired again, budget is now approved (optional)"
                  className={textareaClass}
                  disabled={pending}
                />
              )}
            </Field>
            {error ? (
              <p role="alert" className="text-xs font-semibold text-rose-600">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="lg" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="lg" disabled={pending}>
                {pending ? "Reopening…" : "Reopen lead"}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
