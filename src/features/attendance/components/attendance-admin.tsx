"use client";

import { Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { WEEKDAY_LABELS } from "@/modules/attendance/rules";
import { correctAttendanceAction, updateAttendanceSettingsAction } from "../actions";

type Msg = { text: string; ok: boolean } | null;

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
      {msg.text}
    </p>
  );
}

/** Office hours, late cut-off and weekly days off (HR, Admin, Super Admin). */
export function AttendanceSettingsForm({ officeStart, lateAfter, officeEnd, weekendDays }: { officeStart: string; lateAfter: string; officeEnd: string; weekendDays: number[] }) {
  const [v, setV] = useState({ officeStart, lateAfter, officeEnd, weekendDays });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  const time = (key: "officeStart" | "lateAfter" | "officeEnd", label: string, hint?: string) => (
    <Field label={label} error={errors[key]} hint={hint}>
      {(id, d) => <Input id={id} aria-describedby={d} type="time" value={v[key]} disabled={pending} onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))} />}
    </Field>
  );
  const toggle = (day: number) => setV((s) => ({ ...s, weekendDays: s.weekendDays.includes(day) ? s.weekendDays.filter((d) => d !== day) : [...s.weekendDays, day].sort() }));

  return (
    <form
      noValidate
      aria-label="Attendance settings"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await updateAttendanceSettingsAction(v);
          if (r.ok) {
            setErrors({});
            setMsg({ text: r.data.changed.length ? "Attendance settings saved." : "No changes to save.", ok: true });
          } else {
            setErrors(r.fields ?? {});
            setMsg({ text: r.message, ok: false });
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {time("officeStart", "Office start")}
        {time("lateAfter", "Late after", "A check-in after this time is late.")}
        {time("officeEnd", "Office end")}
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Weekly days off</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((label, day) => (
            <label key={label} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200/80 px-2.5 py-1.5 text-xs font-semibold">
              <input type="checkbox" checked={v.weekendDays.includes(day)} disabled={pending} onChange={() => toggle(day)} className="accent-brand" />
              {label}
            </label>
          ))}
        </div>
        {errors.weekendDays ? <p className="text-xs font-semibold text-rose-600">{errors.weekendDays}</p> : null}
      </fieldset>
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
      <Status msg={msg} />
    </form>
  );
}

/** Correct one person's day (forgot to check in or out), with a reason; audited. */
export function CorrectDay({ userId, name, date, checkIn, checkOut }: { userId: string; name: string; date: string; checkIn: string | null; checkOut: string | null }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ checkIn: checkIn ?? "", checkOut: checkOut ?? "", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[11px] font-bold text-brand hover:underline" aria-label={`Correct ${name}'s day`}>
        <Pencil aria-hidden="true" className="size-3" />
        Correct
      </button>
    );
  return (
    <form
      noValidate
      aria-label={`Correct ${name}'s day`}
      className="mt-1 w-64 space-y-2 rounded-xl border border-zinc-200/80 bg-white p-3 text-left shadow-hairline"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await correctAttendanceAction({ userId, date, ...v });
          if (r.ok) {
            setErrors({});
            setMsg({ text: "Day corrected.", ok: true });
            setOpen(false);
          } else {
            setErrors(r.fields ?? {});
            setMsg({ text: r.message, ok: false });
          }
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Check in" required error={errors.checkIn}>
          {(id, d) => <Input id={id} aria-describedby={d} type="time" value={v.checkIn} disabled={pending} onChange={(e) => setV((s) => ({ ...s, checkIn: e.target.value }))} />}
        </Field>
        <Field label="Check out" error={errors.checkOut}>
          {(id, d) => <Input id={id} aria-describedby={d} type="time" value={v.checkOut} disabled={pending} onChange={(e) => setV((s) => ({ ...s, checkOut: e.target.value }))} />}
        </Field>
      </div>
      <Field label="Reason" required error={errors.note}>
        {(id, d) => <Input id={id} aria-describedby={d} value={v.note} placeholder="e.g. Forgot to check out" disabled={pending} onChange={(e) => setV((s) => ({ ...s, note: e.target.value }))} />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="md" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" size="md" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <Status msg={msg} />
    </form>
  );
}
