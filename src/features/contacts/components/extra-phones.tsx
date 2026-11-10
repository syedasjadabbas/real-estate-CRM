"use client";

import { Field, Input } from "@/components/ui/input";
import { COUNTRY_CODES, FormSection, selectClass } from "@/features/leads/components/lead-fields";
import type { ExtraPhoneInput } from "@/modules/contacts/constants";

/** Phone numbers 2–5 for a lead or client. Only the first number (in Contact) is required. */
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
  return (
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
  );
}
