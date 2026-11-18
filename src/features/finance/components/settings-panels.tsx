"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { cn } from "@/lib/cn";
import { addPaymentMethodAction, setNextBookingNumberAction, setPaymentMethodActiveAction, updateFinanceSettingsAction } from "../actions";

function Status({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
      {msg.text}
    </p>
  );
}

/** Receipt / reversal prefixes. The final format is pending client confirmation (Q-F3). */
export function PrefixPanel({ initial: all, canEdit, nextExample }: { initial: { receipt_prefix: string; reversal_prefix: string }; canEdit: boolean; nextExample: string }) {
  const initial = { receipt_prefix: all.receipt_prefix, reversal_prefix: all.reversal_prefix };
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  return (
    <PanelCard title="Receipt numbering">
      <div className="space-y-3">
        <p className="text-[11px] text-zinc-500">
          Every posted payment gets the next receipt number and each reversal its own reference; numbers are never reused (gaps are possible).
          A receipt reads prefix, the floor code of the unit, then the number (for example BH-GF-123, the format the client confirmed); set the prefix to the project code followed by a dash.
        </p>
        {(["receipt_prefix", "reversal_prefix"] as const).map((key) => (
          <Field key={key} label={key === "receipt_prefix" ? "Receipt prefix" : "Reversal prefix"} error={errors[key]}>
            {(id, d) => (
              <Input id={id} aria-describedby={d} value={values[key]} placeholder="None" disabled={!canEdit || pending} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} />
            )}
          </Field>
        ))}
        <p className="text-xs text-zinc-600">
          Example: receipt <span className="font-bold">{values.receipt_prefix}GF-{nextExample}</span> for a ground-floor unit
        </p>
        {canEdit ? (
          <Button
            variant="primary"
            size="lg"
            disabled={!dirty || pending}
            onClick={() =>
              startTransition(async () => {
                const result = await updateFinanceSettingsAction(values);
                if (result.ok) {
                  setErrors({});
                  setMsg({ text: result.data.changed.length ? "Prefixes saved." : "Nothing changed.", ok: true });
                } else {
                  setErrors(result.fields ?? {});
                  setMsg({ text: result.message, ok: false });
                }
              })
            }
          >
            Save prefixes
          </Button>
        ) : (
          <p className="text-xs text-zinc-600">Only a super admin can change these.</p>
        )}
        <Status msg={msg} />
      </div>
    </PanelCard>
  );
}

/** Configurable payment methods (proposed list; client to confirm). Deactivated, never deleted. */
export function MethodsPanel({ methods, canEdit }: { methods: { id: string; name: string; isActive: boolean }[]; canEdit: boolean }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <PanelCard title="Payment methods">
      <div className="space-y-3">
        <ul className="space-y-1.5">
          {methods.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
              <span className={cn("font-bold", m.isActive ? "text-zinc-900" : "text-zinc-400 line-through")}>{m.name}</span>
              {canEdit ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await setPaymentMethodActiveAction(m.id, !m.isActive);
                      setMsg(result.ok ? { text: `${m.name} ${m.isActive ? "deactivated" : "activated"}.`, ok: true } : { text: result.message, ok: false });
                    })
                  }
                  className="rounded-lg border border-zinc-200/80 bg-white px-2 py-1 text-[10px] font-black text-zinc-700 uppercase hover:bg-zinc-50 disabled:opacity-50"
                >
                  {m.isActive ? "Deactivate" : "Activate"}
                </button>
              ) : (
                <span className="text-[10px] font-black text-zinc-400 uppercase">{m.isActive ? "Active" : "Inactive"}</span>
              )}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3">
            <Field label="New method" error={error} className="min-w-0 flex-1">
              {(id, d) => <Input id={id} aria-describedby={d} value={name} onChange={(e) => setName(e.target.value)} disabled={pending} placeholder="e.g. Pay order" />}
            </Field>
            <Button
              variant="primary"
              size="lg"
              disabled={!name.trim() || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await addPaymentMethodAction(name);
                  if (result.ok) {
                    setName("");
                    setError(undefined);
                    setMsg({ text: "Method added.", ok: true });
                  } else {
                    setError(result.fields?.name);
                    setMsg({ text: result.message, ok: false });
                  }
                })
              }
            >
              Add
            </Button>
          </div>
        ) : null}
        <Status msg={msg} />
      </div>
    </PanelCard>
  );
}

/**
 * Booking numbering (owner, 18 Nov 2026): the prefix in front of every booking number and the number
 * the next booking gets. Only a Super Admin changes them.
 */
export function BookingNumberPanel({ prefix, next, highest, canEdit }: { prefix: string; next: number; highest: number | null; canEdit: boolean }) {
  const [value, setValue] = useState(prefix);
  const [nextValue, setNextValue] = useState(String(next));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = `${value.trim() || "BK-"}${String(Number(nextValue) || next).padStart(4, "0")}`;
  const save = () =>
    startTransition(async () => {
      const saved: string[] = [];
      if (value.trim() !== prefix) {
        const r = await updateFinanceSettingsAction({ booking_prefix: value });
        if (!r.ok) return setErrors(r.fields ?? {}), setMsg({ text: r.message, ok: false });
        saved.push("prefix");
      }
      if (nextValue.trim() !== String(next)) {
        const r = await setNextBookingNumberAction(nextValue);
        if (!r.ok) return setErrors({ next: r.fields?.next ?? r.message }), setMsg({ text: r.fields?.next ?? r.message, ok: false });
        saved.push("next number");
      }
      setErrors({});
      setMsg({ text: saved.length ? `Saved ${saved.join(" and ")}.` : "Nothing changed.", ok: true });
    });
  return (
    <PanelCard title="Booking numbering">
      <div className="space-y-3">
        <p className="text-[11px] text-zinc-500">
          Every booking gets the next number when it is made; numbers are never reused. It shows on the bookings list, the booking page and the printed booking form, receipt and sales order.
          {highest ? ` The highest number so far is ${highest}.` : ""}
        </p>
        <Field label="Prefix" error={errors.booking_prefix} hint="Empty means BK-">
          {(id, d) => <Input id={id} aria-describedby={d} value={value} placeholder="BK-" disabled={!canEdit || pending} onChange={(e) => setValue(e.target.value)} />}
        </Field>
        <Field label="Next booking number" error={errors.next} hint="Must be above the highest number so far">
          {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" value={nextValue} disabled={!canEdit || pending} onChange={(e) => setNextValue(e.target.value)} />}
        </Field>
        <p className="text-xs text-zinc-600">
          The next booking will be <span className="font-bold">{shown}</span>
        </p>
        {canEdit ? (
          <Button variant="primary" size="lg" disabled={pending || (value.trim() === prefix && nextValue.trim() === String(next))} onClick={save}>
            Save booking numbering
          </Button>
        ) : (
          <p className="text-xs text-zinc-600">Only a Super Admin can change these.</p>
        )}
        <Status msg={msg} />
      </div>
    </PanelCard>
  );
}

const TERM_FIELDS = [
  { key: "installment_grace_days", label: "Instalment grace (days)", hint: "An instalment due on the 10th is overdue after this many days" },
  { key: "down_payment_due_days", label: "Down payment due (days after booking)", hint: "When the down payment falls due" },
  { key: "down_payment_grace_days", label: "Down payment grace (days)", hint: "Extra days before an unpaid down payment is overdue" },
] as const;
type TermKey = (typeof TERM_FIELDS)[number]["key"];

/**
 * Payment grace periods (owner, 18 Nov 2026): when an unpaid instalment or down payment counts as
 * overdue on Outstanding and in the reports. Only a Super Admin changes them.
 */
export function PaymentTermsPanel({ initial, defaults, canEdit }: { initial: Record<TermKey, string>; defaults: Record<TermKey, number>; canEdit: boolean }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  return (
    <PanelCard title="Payment grace periods">
      <div className="space-y-3">
        <p className="text-[11px] text-zinc-500">Used for overdue amounts and aging on Finance → Outstanding and in the reports. Leave a box empty to use the standard value shown.</p>
        {TERM_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} error={errors[f.key]} hint={`${f.hint}. Standard: ${defaults[f.key]}`}>
            {(id, d) => (
              <Input id={id} aria-describedby={d} inputMode="numeric" value={values[f.key]} placeholder={String(defaults[f.key])} disabled={!canEdit || pending} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
            )}
          </Field>
        ))}
        {canEdit ? (
          <Button
            variant="primary"
            size="lg"
            disabled={!dirty || pending}
            onClick={() =>
              startTransition(async () => {
                const r = await updateFinanceSettingsAction(values);
                if (r.ok) {
                  setErrors({});
                  setMsg({ text: r.data.changed.length ? "Grace periods saved." : "Nothing changed.", ok: true });
                } else {
                  setErrors(r.fields ?? {});
                  setMsg({ text: r.message, ok: false });
                }
              })
            }
          >
            Save grace periods
          </Button>
        ) : (
          <p className="text-xs text-zinc-600">Only a Super Admin can change these.</p>
        )}
        <Status msg={msg} />
      </div>
    </PanelCard>
  );
}
