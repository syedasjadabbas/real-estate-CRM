"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { COUNTRY_CODES, FormSection, selectClass } from "@/features/leads/components/lead-fields";
import type { ExtraPhoneInput } from "@/modules/contacts/constants";

/**
 * Phone numbers 2–5 for a lead or client. Only the first number (in Contact) is required. Folded
 * away by default (owner, 16 Nov 2026); the header says how many are filled in, and the section
 * opens by itself when one of the numbers has an error.
 */
export function ExtraPhonesFields({
  phones,
  onChange,
  errors,
  disabled,
}: {
  phones: ExtraPhoneInput[];
  onChange: (phones: ExtraPhoneInput[]) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}) {
  const set = (i: number, patch: Partial<ExtraPhoneInput>) => onChange(phones.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const filled = phones.filter((p) => p.number.trim()).length;
  const hasError = Boolean(errors.phones) || phones.some((_, i) => errors[`phones.${i}`]);
  const shown = open || hasError;
  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 text-left shadow-hairline transition-colors hover:bg-zinc-50"
      >
        <span className="text-[10px] font-black tracking-[0.2em] text-brand uppercase">Additional numbers</span>
        <span className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
          {filled ? `${filled} added` : "None added"} · Show
          <ChevronDown aria-hidden="true" className="size-4" />
        </span>
      </button>
    );
  }
  return (
    <div id={panelId} className="relative">
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-expanded
        aria-controls={panelId}
        disabled={hasError}
        className={cn("absolute top-4 right-5 z-10 flex items-center gap-1 text-xs font-semibold text-zinc-500 hover:text-zinc-800", hasError && "hidden")}
      >
        Hide
        <ChevronDown aria-hidden="true" className="size-4 rotate-180" />
      </button>
    <FormSection title="Additional numbers">
      {phones.map((p, i) => (
        <div key={i} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-2">
          <Field label={`Phone ${i + 2} code`}>
            {(id) => (
              <select id={id} value={p.countryCode} disabled={disabled} onChange={(e) => set(i, { countryCode: e.target.value })} className={selectClass}>
                {COUNTRY_CODES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.value}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={`Phone ${i + 2}`} error={errors[`phones.${i}`]}>
            {(id, describedBy) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={Boolean(errors[`phones.${i}`])}
                type="tel"
                value={p.number}
                placeholder="Optional"
                autoComplete="off"
                disabled={disabled}
                onChange={(e) => set(i, { number: e.target.value })}
              />
            )}
          </Field>
        </div>
      ))}
      <p className="text-[11px] text-zinc-500 sm:col-span-2">
        Optional. A customer is recognised by any of their numbers, so a returning customer stays with their original agent.
      </p>
      {errors.phones ? (
        <p role="alert" className="text-xs font-semibold text-rose-600 sm:col-span-2">
          {errors.phones}
        </p>
      ) : null}
    </FormSection>
    </div>
  );
}
