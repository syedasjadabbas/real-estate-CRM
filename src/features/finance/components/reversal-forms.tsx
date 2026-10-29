"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { cn } from "@/lib/cn";
import { decideReversalAction, requestReversalAction } from "../actions";

function Status({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
      {msg.text}
    </p>
  );
}

/** Accountant asks for a reversal; nothing changes until a manager or admin approves. */
export function RequestReversalForm({ paymentId }: { paymentId: string }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <Field label="Reason" required error={error}>
        {(id, describedBy) => (
          <textarea
            id={id}
            aria-describedby={describedBy}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Entered against the wrong booking"
            className={textareaClass}
            disabled={pending}
          />
        )}
      </Field>
      <Button
        variant="secondary"
        size="lg"
        className="border-rose-200 text-rose-700 hover:bg-rose-50"
        disabled={!reason.trim() || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await requestReversalAction(paymentId, reason);
            if (result.ok) {
              setReason("");
              setError(undefined);
              setMsg({ text: "Reversal requested. A manager or admin must approve it.", ok: true });
            } else {
              setError(result.fields?.reason);
              setMsg({ text: result.message, ok: false });
            }
          })
        }
      >
        Request reversal
      </Button>
      <Status msg={msg} />
    </div>
  );
}

/** Manager (own team) / admin decision on a pending reversal request. */
export function DecideReversalForm({ requestId, compact = false }: { requestId: string; compact?: boolean }) {
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const decide = (approve: boolean) =>
    startTransition(async () => {
      const result = await decideReversalAction(requestId, approve, note);
      if (result.ok) setMsg({ text: approve ? "Reversal approved and posted." : "Reversal rejected. The payment stands.", ok: true });
      else setMsg({ text: result.message, ok: false });
    });
  return (
    <div className="space-y-2">
      <label className="sr-only" htmlFor={`decision-${requestId}`}>
        Decision note
      </label>
      <textarea
        id={`decision-${requestId}`}
        rows={compact ? 1 : 2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Decision note (optional)"
        className={textareaClass}
        disabled={pending}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="lg" disabled={pending} onClick={() => decide(true)}>
          Approve reversal
        </Button>
        <Button variant="secondary" size="lg" disabled={pending} onClick={() => decide(false)}>
          Reject
        </Button>
      </div>
      <Status msg={msg} />
    </div>
  );
}
