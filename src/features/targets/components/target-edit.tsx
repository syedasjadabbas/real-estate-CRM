"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { setTargetAction } from "@/features/teams/actions";
import { TARGET_PERIOD_LABELS, type TargetPeriod } from "@/modules/targets/period";

type Values = { calls: number; meetings: number; soldSqft: number };
type Goal = { name: string; goal: number; achieved: number };

/** FR-110 set / edit one agent's target for the period. Setting all three to 0 clears it (T-A8). */
export function TargetEditButton({
  userId,
  name,
  period,
  periodStart,
  periodEnd = null,
  current,
  custom = [],
}: {
  userId: string;
  name: string;
  period: TargetPeriod;
  periodStart: string;
  periodEnd?: string | null;
  current: Values | null;
  /** Custom goals with hand-entered progress (15 Nov 2026). */
  custom?: Goal[];
}) {
  const [open, setOpen] = useState(false);
  const [goals, setGoals] = useState(custom.map((g) => ({ name: g.name, goal: String(g.goal), achieved: String(g.achieved) })));
  const setGoal = (i: number, patch: Partial<(typeof goals)[number]>) => setGoals((list) => list.map((g, j) => (j === i ? { ...g, ...patch } : g)));
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
        {current || custom.length ? "Edit" : "Set"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Target · ${name}`}
        description={`${period === "custom" && periodEnd ? `Custom period ${periodStart} to ${periodEnd}` : `${TARGET_PERIOD_LABELS[period]} period starting ${periodStart}`}. Leave everything at 0 and remove custom goals to clear the target.`}
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
                  const result = await setTargetAction({ userId, period, anchor: periodStart, ...(periodEnd ? { to: periodEnd } : {}), ...v, custom: goals.filter((g) => g.name.trim() || g.goal) });
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
          {field("calls", "Calls", "Counted from call recordings this agent uploaded to leads (one recording = one call).")}
          {field("meetings", "Meetings", "Counted from completed meetings this agent organized.")}
          {field("soldSqft", "Sold sq ft", "Counted from this agent's bookings confirmed in the period.")}

          <fieldset className="space-y-2 border-t border-zinc-100 pt-3">
            <legend className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Custom goals</legend>
            <p className="text-[11px] text-zinc-500">Anything the CRM can&apos;t count, e.g. &quot;Brochures delivered&quot;. You enter the progress here as it happens.</p>
            {goals.map((g, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_auto] items-end gap-2">
                <Field label={i === 0 ? "Goal" : ""} error={errors[`custom.${i}.name`]}>
                  {(id, d) => <Input id={id} aria-describedby={d} aria-label="Goal name" maxLength={60} value={g.name} placeholder="e.g. Brochures delivered" disabled={pending} onChange={(e) => setGoal(i, { name: e.target.value })} />}
                </Field>
                <Field label={i === 0 ? "Target" : ""} error={errors[`custom.${i}.goal`]}>
                  {(id, d) => <Input id={id} aria-describedby={d} aria-label="Target" inputMode="decimal" value={g.goal} placeholder="0" disabled={pending} onChange={(e) => setGoal(i, { goal: e.target.value })} />}
                </Field>
                <Field label={i === 0 ? "Done so far" : ""} error={errors[`custom.${i}.achieved`]}>
                  {(id, d) => <Input id={id} aria-describedby={d} aria-label="Done so far" inputMode="decimal" value={g.achieved} placeholder="0" disabled={pending} onChange={(e) => setGoal(i, { achieved: e.target.value })} />}
                </Field>
                <Button type="button" variant="secondary" className="h-10 px-2.5" aria-label={`Remove goal ${g.name || i + 1}`} disabled={pending} onClick={() => setGoals((list) => list.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </div>
            ))}
            {errors.custom ? <p className="text-xs font-semibold text-rose-600">{errors.custom}</p> : null}
            {goals.length < 10 ? (
              <Button type="button" variant="secondary" className="h-[30px] px-2.5 text-xs" disabled={pending} onClick={() => setGoals((list) => [...list, { name: "", goal: "", achieved: "0" }])}>
                <Plus aria-hidden="true" className="size-3.5" />
                Add a custom goal
              </Button>
            ) : null}
          </fieldset>
        </div>
      </Modal>
    </>
  );
}
