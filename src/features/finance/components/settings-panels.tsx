"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { cn } from "@/lib/cn";
import { addPaymentMethodAction, setPaymentMethodActiveAction, updateFinanceSettingsAction } from "../actions";

function Status({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
      {msg.text}
    </p>
  );
}

/** Receipt / reversal prefixes. The final format is pending client confirmation (Q-F3). */
export function PrefixPanel({ initial, canEdit, nextExample }: { initial: { receipt_prefix: string; reversal_prefix: string }; canEdit: boolean; nextExample: string }) {
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
          The prefix is shown in front of the number. The final format is pending client confirmation.
        </p>
        {(["receipt_prefix", "reversal_prefix"] as const).map((key) => (
          <Field key={key} label={key === "receipt_prefix" ? "Receipt prefix" : "Reversal prefix"} error={errors[key]}>
            {(id, d) => (
              <Input id={id} aria-describedby={d} value={values[key]} placeholder="None" disabled={!canEdit || pending} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} />
            )}
          </Field>
        ))}
        <p className="text-xs text-zinc-600">
          Example: receipt <span className="font-bold">{values.receipt_prefix}{nextExample}</span>
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
