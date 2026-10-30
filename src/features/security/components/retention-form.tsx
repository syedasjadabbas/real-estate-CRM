"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { FormSection } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import { MAX_RETENTION_MONTHS, MIN_RETENTION_MONTHS } from "@/modules/security/retention";
import { updateRetentionSettingsAction } from "../actions";

/** Retention period and the automatic-deletion switch. Enabling deletion asks for confirmation. */
export function RetentionForm({ retentionMonths, cleanupEnabled }: { retentionMonths: number; cleanupEnabled: boolean }) {
  const [months, setMonths] = useState(String(retentionMonths));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = (input: Record<string, unknown>, done: string) =>
    startTransition(async () => {
      const result = await updateRetentionSettingsAction(input);
      if (result.ok) {
        setErrors({});
        setConfirming(false);
        setMsg({ text: result.data.changed.length ? done : "No changes to save.", ok: true });
      } else {
        setErrors(result.fields ?? {});
        setMsg({ text: result.message, ok: false });
      }
    });

  return (
    <div className="space-y-4">
      <form
        noValidate
        aria-label="Retention period"
        onSubmit={(e) => {
          e.preventDefault();
          save({ retentionMonths: months }, "Retention period saved.");
        }}
        className="space-y-4"
      >
        <FormSection title="Retention period">
          <Field
            label="Keep sign-in history for (months)"
            hint={`${MIN_RETENTION_MONTHS}–${MAX_RETENTION_MONTHS} months. 12 is the proposed default, pending client confirmation.`}
            error={errors.retentionMonths}
          >
            {(id, describedBy) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={Boolean(errors.retentionMonths)}
                inputMode="numeric"
                value={months}
                disabled={pending}
                onChange={(e) => setMonths(e.target.value)}
              />
            )}
          </Field>
        </FormSection>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button type="submit" variant="primary" size="lg" disabled={pending} className="px-5">
            {pending ? "Saving…" : "Save period"}
          </Button>
        </div>
      </form>

      <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-hairline">
        <p className="mb-1 text-[10px] font-black tracking-[0.2em] text-brand uppercase">Automatic deletion</p>
        <p className="text-sm font-bold text-zinc-900">{cleanupEnabled ? "On — old sign-in history is deleted daily" : "Off — nothing is deleted"}</p>
        <p className="mt-1 text-xs text-zinc-600">
          {cleanupEnabled
            ? "The daily cleanup job permanently deletes sign-in history older than the retention period. Audit logs are never deleted."
            : "Keep this off until the client confirms the retention policy. While it is off, the cleanup job only reports how many entries would be eligible."}
        </p>
        {errors.cleanupEnabled ? <p className="mt-2 text-xs font-semibold text-rose-600">{errors.cleanupEnabled}</p> : null}
        <div className="mt-3 flex justify-end">
          {cleanupEnabled ? (
            <Button variant="secondary" size="lg" disabled={pending} onClick={() => save({ cleanupEnabled: false }, "Automatic deletion turned off.")}>
              Turn off automatic deletion
            </Button>
          ) : (
            <Button variant="secondary" size="lg" disabled={pending} onClick={() => setConfirming(true)}>
              Turn on automatic deletion…
            </Button>
          )}
        </div>
      </div>

      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={cn("text-right text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
          {msg.text}
        </p>
      ) : null}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Turn on automatic deletion?"
        description={`Sign-in history older than ${retentionMonths} months will be permanently deleted by the daily cleanup job. This cannot be undone.`}
        footer={
          <>
            <Button variant="secondary" size="lg" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" disabled={pending} onClick={() => save({ cleanupEnabled: true, confirmEnable: true }, "Automatic deletion turned on.")}>
              {pending ? "Saving…" : "Delete old history automatically"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-700">Only turn this on after the client has approved the retention policy. Audit logs and all other records are not affected.</p>
      </Modal>
    </div>
  );
}
