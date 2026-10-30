"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { markAllReadAction, updateReminderAction } from "../actions";
import { NOTIFICATIONS_CHANGED } from "./notification-bell";

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="lg"
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          await markAllReadAction();
          window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
        })
      }>
      <Check aria-hidden="true" className="size-4" />
      {pending ? "Marking…" : "Mark all read"}
    </Button>
  );
}

/** Follow-up reminder window (super admin / admin). Blank = reminders off. */
export function ReminderForm({ minutes }: { minutes: number | null }) {
  const [value, setValue] = useState(minutes === null ? "" : String(minutes));
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      noValidate
      aria-label="Follow-up reminder window"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await updateReminderAction({ minutes: value.trim() });
          if (result.ok) {
            setError(null);
            setMsg({ text: result.data.changed ? (value.trim() ? "Reminder window saved." : "Follow-up reminders turned off.") : "No changes to save.", ok: true });
          } else {
            setError(result.fields?.minutes ?? null);
            setMsg({ text: result.message, ok: false });
          }
        });
      }}
    >
      <Field label="Remind assignees this many minutes before a follow-up is due" hint="1–1,440 minutes. Leave blank to keep follow-up reminders off." error={error ?? undefined}>
        {(id, describedBy) => (
          <Input id={id} aria-describedby={describedBy} invalid={Boolean(error)} inputMode="numeric" value={value} placeholder="Off" disabled={pending} onChange={(e) => setValue(e.target.value)} />
        )}
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
