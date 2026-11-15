"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { selectClass } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import { PRORATION_METHODS, STAFF_STEP_APPROVERS, STAFF_STEP_LABELS, type ProrationMethod, type StaffStepApprover } from "@/modules/leave/rules";
import { cancelApprovedLeaveAction, decideLeaveAction, decideLeaveCancellationAction, updateLeaveSettingsAction } from "../actions";

type Msg = { text: string; ok: boolean } | null;
function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
      {msg.text}
    </p>
  );
}

/** Approve or reject a step (approvals), or a cancellation request (Admin / Super Admin). */
export function LeaveDecision({ id, name, kind }: { id: string; name: string; kind: "approval" | "cancellation" }) {
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  const decide = (approve: boolean) =>
    startTransition(async () => {
      const action = kind === "approval" ? decideLeaveAction : decideLeaveCancellationAction;
      const r = await action(id, { approve, comment });
      setMsg(r.ok ? { text: approve ? "Approved." : "Rejected.", ok: true } : { text: r.message, ok: false });
    });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Comment" className="min-w-[180px] flex-1">
        {(fid) => <Input id={fid} aria-label={`Comment for ${name}`} value={comment} maxLength={500} disabled={pending} onChange={(e) => setComment(e.target.value)} />}
      </Field>
      <Button variant="primary" size="lg" disabled={pending} onClick={() => decide(true)} aria-label={`${kind === "approval" ? "Approve" : "Approve cancellation for"} ${name}`}>
        Approve
      </Button>
      <Button variant="secondary" size="lg" disabled={pending} onClick={() => decide(false)} aria-label={`${kind === "approval" ? "Reject" : "Refuse cancellation for"} ${name}`}>
        Reject
      </Button>
      <Status msg={msg} />
    </div>
  );
}

/** Admin / Super Admin: cancel approved leave with a reason (Q15). */
export function CancelApprovedLeave({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  if (!open) {
    return (
      <button type="button" className="text-[11px] font-bold text-rose-600 hover:underline" onClick={() => setOpen(true)} aria-label={`Cancel leave of ${name}`}>
        Cancel leave
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Reason" className="min-w-[180px] flex-1">
        {(fid) => <Input id={fid} value={reason} maxLength={500} disabled={pending} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Button
        variant="secondary"
        size="lg"
        disabled={pending || !reason.trim()}
        onClick={() =>
          startTransition(async () => {
            const r = await cancelApprovedLeaveAction(id, { reason });
            setMsg(r.ok ? { text: "Leave cancelled; the days return to the balance.", ok: true } : { text: r.message, ok: false });
          })
        }
      >
        Confirm cancellation
      </Button>
      <Status msg={msg} />
    </div>
  );
}

/** Admin / Super Admin: allowance and the two staff approval steps (Q4, Q6; the order is the client's decision, C-4). */
export function LeaveSettingsForm({
  annualDays,
  staffStep1,
  staffStep2,
  prorationMethod,
}: {
  annualDays: number;
  staffStep1: StaffStepApprover;
  staffStep2: StaffStepApprover | null;
  prorationMethod: ProrationMethod;
}) {
  const [v, setV] = useState({ annualDays: String(annualDays), staffStep1: staffStep1 as string, staffStep2: staffStep2 as string, prorationMethod: prorationMethod as string });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  const step = (key: "staffStep1" | "staffStep2", label: string) => (
    <Field label={label} error={errors[key]}>
      {(id, d) => (
        <select id={id} aria-describedby={d} className={selectClass} value={v[key]} disabled={pending} onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))}>
          {STAFF_STEP_APPROVERS.map((a) => (
            <option key={a} value={a}>
              {STAFF_STEP_LABELS[a]}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
  return (
    <form
      noValidate
      aria-label="Leave settings"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await updateLeaveSettingsAction({ annualDays: v.annualDays, staffStep1: v.staffStep1, staffStep2: v.staffStep2, prorationMethod: v.prorationMethod });
          if (r.ok) {
            setErrors({});
            setMsg({ text: r.data.changed.length ? "Leave settings saved." : "No changes to save.", ok: true });
          } else {
            setErrors(r.fields ?? {});
            setMsg({ text: r.message, ok: false });
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Annual allowance (days)" error={errors.annualDays} hint="The same for everyone.">
          {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" value={v.annualDays} disabled={pending} onChange={(e) => setV((s) => ({ ...s, annualDays: e.target.value }))} />}
        </Field>
        {step("staffStep1", "Staff approval: first step")}
        {step("staffStep2", "Staff approval: second step")}
      </div>
      {(Object.keys(PRORATION_METHODS) as ProrationMethod[]).length > 1 ? (
        <Field label="Proration for joiners" error={errors.prorationMethod}>
          {(id, d) => (
            <select id={id} aria-describedby={d} className={selectClass} value={v.prorationMethod} disabled={pending} onChange={(e) => setV((s) => ({ ...s, prorationMethod: e.target.value }))}>
              {(Object.keys(PRORATION_METHODS) as ProrationMethod[]).map((k) => (
                <option key={k} value={k}>
                  {PRORATION_METHODS[k].label}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : (
        // One method only until the company confirms theirs: shown as text, not a one-choice dropdown (15 Nov 2026).
        <div className="space-y-1">
          <p className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Proration for joiners</p>
          <p className="text-sm text-zinc-800">
            Someone who joins during the year gets a share of the allowance for the days left in the year, rounded to the nearest half day. Example: joining on 1 July gives
            about 15 of 30 days.
          </p>
          <p className="text-[11px] text-amber-800">Temporary method until the company confirms theirs; it can be changed here then.</p>
        </div>
      )}
      <p className="text-[11px] text-zinc-500">
        Agents&apos; and accountants&apos; leave needs two approvals by two different people: HR first, then an Admin, unless you change the order above. HR&apos;s and Admins&apos;
        leave is approved by a Super Admin, and a Super Admin&apos;s own leave is approved automatically. Nobody approves their own leave.
      </p>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Status msg={msg} />
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          Save leave settings
        </Button>
      </div>
    </form>
  );
}
