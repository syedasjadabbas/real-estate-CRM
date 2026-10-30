"use client";

import { Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { setTargetAction } from "@/features/teams/actions";
import { TARGET_PERIOD_LABELS, type TargetPeriod } from "@/modules/targets/period";

type Values = { calls: number; meetings: number; soldSqft: number };

/** FR-110 set / edit one agent's target for the period. Setting all three to 0 clears it (T-A8). */
export function TargetEditButton({ userId, name, period, periodStart, current }: { userId: string; name: string; period: TargetPeriod; periodStart: string; current: Values | null }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ calls: String(current?.calls ?? ""), meetings: String(current?.meetings ?? ""), soldSqft: String(current?.soldSqft ?? "") });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const field = (key: keyof typeof v, label: string, hint?: string) => (
    <Field label={label} error={errors[key]} hint={hint}>
      {(id, d) => (
        <Input id={id} aria-describedby={d} invalid={Boolean(errors[key])} inputMode="decimal" value={v[key]} placeholder="0" disabled={pending} onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))} />
      )}
    </Field>
  );
  return (
    <>
      <Button type="button" variant="secondary" className="h-[30px] px-2.5 text-xs" onClick={() => setOpen(true)} aria-label={`Set target for ${name}`}>
        <Pencil aria-hidden="true" className="size-3.5" />
        {current ? "Edit" : "Set"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Target · ${name}`}
        description={`${TARGET_PERIOD_LABELS[period]} period starting ${periodStart}. Leave all three at 0 to clear the target.`}
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="lg"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await setTargetAction({ userId, period, anchor: periodStart, ...v });
                  if (result.ok) {
                    setErrors({});
                    setMsg(null);
                    setOpen(false);
                  } else {
                    setErrors(result.fields ?? {});
                    setMsg(result.message);
                  }
                })
              }
            >
              {pending ? "Saving…" : "Save target"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {msg ? (
            <p role="alert" className="text-xs font-semibold text-rose-600">
              {msg}
            </p>
          ) : null}
          {field("calls", "Calls (qualified)", "Achievement appears once call data is available.")}
          {field("meetings", "Meetings", "Counted from completed meetings this agent organized.")}
          {field("soldSqft", "Sold sq ft", "Counted from this agent's bookings confirmed in the period.")}
        </div>
      </Modal>
    </>
  );
}
