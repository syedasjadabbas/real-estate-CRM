"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DateTimeInput } from "@/components/ui/date-time-input";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/server/errors";
import { cancelFollowUpAction, completeFollowUpAction, rescheduleFollowUpAction } from "../actions";
import { formatDateTime, fromLocalInputValue, toLocalInputValue } from "../format";

type Item = { id: string; dueAt: Date | string; note: string | null; status: "pending" | "done" | "cancelled"; doneAt: Date | string | null; missedAt: Date | string | null };
const small = "inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200/80 bg-white px-2 py-1 text-[10px] font-black text-zinc-700 uppercase hover:bg-zinc-50 disabled:opacity-50";

/** One follow-up on the lead page: done, rescheduled or cancelled, each kept in the history. */
export function FollowUpItem({ item: f, now, canEdit }: { item: Item; now: number; canEdit: boolean }) {
  const [mode, setMode] = useState<"reschedule" | "cancel" | null>(null);
  const [due, setDue] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const overdue = f.status === "pending" && new Date(f.dueAt).getTime() < now;

  const run = (fn: () => Promise<ActionResult<unknown>>) =>
    startTransition(async () => {
      const r = await fn();
      setErrors(r.ok ? {} : (r.fields ?? {}));
      setError(r.ok || r.fields ? null : r.message);
      if (r.ok) {
        setMode(null);
        setReason("");
      }
    });
  const open = (m: "reschedule" | "cancel") => {
    setMode(m === mode ? null : m);
    setErrors({});
    setError(null);
    setReason("");
    setDue(toLocalInputValue(new Date(Math.max(new Date(f.dueAt).getTime(), Date.now()) + 24 * 3_600_000)));
  };

  return (
    <li className="space-y-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("font-bold", overdue ? "text-rose-600" : f.status === "pending" ? "text-zinc-900" : "text-zinc-400 line-through")}>
            {formatDateTime(f.dueAt)}
            {overdue ? (f.missedAt ? " · missed" : " · overdue") : ""}
          </p>
          {f.note ? <p className="text-zinc-600">{f.note}</p> : null}
          {f.status === "done" ? <p className="text-[11px] text-zinc-500">Done {f.doneAt ? formatDateTime(f.doneAt) : ""}</p> : null}
          {f.status === "cancelled" ? <p className="text-[11px] text-zinc-500">Cancelled</p> : null}
        </div>
        {f.status === "pending" && canEdit ? (
          <div className="flex flex-wrap gap-1">
            <button type="button" disabled={pending} onClick={() => run(() => completeFollowUpAction(f.id))} className={small}>
              <Check aria-hidden="true" className="size-3" /> Done
            </button>
            <button type="button" disabled={pending} aria-expanded={mode === "reschedule"} onClick={() => open("reschedule")} className={small}>
              Reschedule
            </button>
            <button type="button" disabled={pending} aria-expanded={mode === "cancel"} onClick={() => open("cancel")} className={small}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
      {mode ? (
        <form
          noValidate
          aria-label={mode === "cancel" ? "Cancel follow-up" : "Reschedule follow-up"}
          className="space-y-2 border-t border-zinc-100 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => (mode === "cancel" ? cancelFollowUpAction(f.id, reason) : rescheduleFollowUpAction(f.id, { dueAt: due ? fromLocalInputValue(due) : "", reason })));
          }}
        >
          {mode === "reschedule" ? (
            <Field label="New time (Pakistan time)" required error={errors.dueAt}>
              {(id, d) => <DateTimeInput id={id} describedBy={d} invalid={Boolean(errors.dueAt)} value={due} disabled={pending} onChange={setDue} />}
            </Field>
          ) : null}
          <Field label="Reason" required={mode === "cancel"} error={errors.reason}>
            {(id, d) => <Input id={id} aria-describedby={d} invalid={Boolean(errors.reason)} maxLength={500} value={reason} disabled={pending} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => setMode(null)}>
              Back
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : mode === "cancel" ? "Cancel follow-up" : "Reschedule"}
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="font-semibold text-rose-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}
