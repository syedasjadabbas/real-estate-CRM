"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { selectClass } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import { calendarDays, LEAVE_TYPE_LABELS, LEAVE_TYPES, type LeaveType } from "@/modules/leave/rules";
import { recordLeaveAction } from "../actions";

/**
 * HR, Admins and Super Admins record leave for someone else (owner, 15 Nov 2026): a person who
 * phoned in sick, or staff with no CRM login who can't ask for leave themselves.
 */
export function RecordLeaveForm({ people, approvesNow }: { people: { value: string; label: string }[]; approvesNow: string }) {
  const empty = { person: "", type: "annual" as LeaveType, startDate: "", endDate: "", reason: "" };
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const days = v.startDate && v.endDate && v.startDate <= v.endDate ? calendarDays(v.startDate, v.endDate) : 0;

  return (
    <form
      noValidate
      aria-label="Record leave for someone"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await recordLeaveAction(v);
          if (r.ok) {
            const n = `${r.data.days} day${r.data.days === 1 ? "" : "s"}`;
            setErrors({});
            setMsg({ text: r.data.held ? `Recorded: ${n}, held (two calendar years).` : r.data.status === "approved" ? `Recorded and approved: ${n}.` : `Recorded: ${n}, waiting for approval.`, ok: true });
            setV(empty);
          } else {
            setErrors(r.fields ?? {});
            setMsg({ text: r.fields?.endDate ?? r.fields?.startDate ?? r.fields?.person ?? r.message, ok: false });
          }
        });
      }}
    >
      <p className="text-[11px] text-zinc-500">
        For someone who phoned in sick, or staff with no CRM login. Everyone else asks for leave from My workplace. {approvesNow}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Person" required error={errors.person}>
          {(id, d) => (
            <select id={id} aria-describedby={d} className={selectClass} value={v.person} disabled={pending} onChange={(e) => setV((s) => ({ ...s, person: e.target.value }))}>
              <option value="">Choose a person…</option>
              {people.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Leave type" error={errors.type}>
          {(id, d) => (
            <select id={id} aria-describedby={d} className={selectClass} value={v.type} disabled={pending} onChange={(e) => setV((s) => ({ ...s, type: e.target.value as LeaveType }))}>
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LEAVE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="First day" required error={errors.startDate}>
          {(id, d) => <Input id={id} aria-describedby={d} type="date" invalid={Boolean(errors.startDate)} value={v.startDate} disabled={pending} onChange={(e) => setV((s) => ({ ...s, startDate: e.target.value }))} />}
        </Field>
        <Field label="Last day" required error={errors.endDate} hint={days ? `${days} calendar day${days === 1 ? "" : "s"}` : undefined}>
          {(id, d) => <Input id={id} aria-describedby={d} type="date" invalid={Boolean(errors.endDate)} value={v.endDate} disabled={pending} onChange={(e) => setV((s) => ({ ...s, endDate: e.target.value }))} />}
        </Field>
      </div>
      <Field label="Reason" required error={errors.reason}>
        {(id, d) => <Input id={id} aria-describedby={d} maxLength={500} placeholder="e.g. Phoned in sick" value={v.reason} disabled={pending} onChange={(e) => setV((s) => ({ ...s, reason: e.target.value }))} />}
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Record leave"}
        </Button>
      </div>
    </form>
  );
}
