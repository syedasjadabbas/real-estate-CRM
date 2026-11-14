"use client";

import type { ReactNode } from "react";
import { Field, Input } from "@/components/ui/input";
import { COUNTRY_CODES, FormSection, selectClass } from "@/features/leads/components/lead-fields";
import { cityOptions, OTHER_CITY } from "@/modules/cities/constants";
import { ExtraPhonesFields } from "@/features/contacts/components/extra-phones";
import type { ExtraPhoneInput } from "@/modules/contacts/constants";
import { RELATIONSHIPS, RELATIONSHIP_LABELS } from "@/modules/clients/constants";

export type ClientFormValues = {
  name: string;
  phoneCountryCode: string;
  phoneNumber: string;
  email: string;
  cityId: string;
  cityOther: string;
  relationship: string;
  /** Numbers 2–5. */
  phones: ExtraPhoneInput[];
};

type TextKey = Exclude<keyof ClientFormValues, "phones">;

type Props = {
  values: ClientFormValues;
  onChange: (patch: Partial<ClientFormValues>) => void;
  errors: Record<string, string>;
  cities: { id: string; name: string }[];
  disabled?: boolean;
  /** Phone numbers read-only (agents editing a client, 14 Nov 2026). */
  lockPhones?: boolean;
  /** Extra controls appended to the Profile section (owner on the create form). */
  profileExtra?: ReactNode;
  /** The record's saved list city, kept as an option if it has since been deactivated. */
  currentCity?: { id: string; name: string | null } | null;
};

/** Client fields shared by the create form and the detail page's edit form (Leads form sections). */
export function ClientFields({ values, onChange, errors, cities, disabled, lockPhones = false, profileExtra, currentCity }: Props) {
  const text = (key: TextKey, label: string, opts: { required?: boolean; type?: string; placeholder?: string; lock?: boolean } = {}) => (
    <Field label={label} required={opts.required} error={errors[key]}>
      {(id, describedBy) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          invalid={Boolean(errors[key])}
          type={opts.type ?? "text"}
          value={values[key]}
          placeholder={opts.placeholder}
          autoComplete="off"
          disabled={disabled || opts.lock}
          onChange={(e) => onChange({ [key]: e.target.value })}
        />
      )}
    </Field>
  );
  const select = (
    key: TextKey,
    label: string,
    options: { value: string; label: string }[],
    opts: { required?: boolean; empty?: string; hint?: string; lock?: boolean } = {},
  ) => (
    <Field label={label} required={opts.required} error={errors[key]} hint={opts.hint}>
      {(id, describedBy) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={Boolean(errors[key]) || undefined}
          value={values[key]}
          disabled={disabled || opts.lock}
          onChange={(e) => onChange({ [key]: e.target.value })}
          className={selectClass}
        >
          {opts.empty !== undefined ? <option value="">{opts.empty}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  return (
    <div className="space-y-4">
      <FormSection title="Contact">
        {text("name", "Name", { required: true })}
        {text("email", "Email", { type: "email", placeholder: "Optional" })}
        {select("phoneCountryCode", "Country code", COUNTRY_CODES, { required: true, lock: lockPhones })}
        {text("phoneNumber", "Mobile number", { required: true, type: "tel", placeholder: "3001234567 or 0300 1234567", lock: lockPhones })}
      </FormSection>
      <ExtraPhonesFields phones={values.phones} onChange={(phones) => onChange({ phones })} errors={errors} disabled={disabled || lockPhones} />
      {lockPhones ? <p className="-mt-2 text-[11px] text-zinc-500">Phone numbers can only be changed by an Admin.</p> : null}
      <FormSection title="Profile">
        {select(
          "relationship",
          "Relationship",
          RELATIONSHIPS.map((r) => ({ value: r, label: RELATIONSHIP_LABELS[r] })),
          { empty: "Not set", hint: "Values pending client confirmation" },
        )}
        {select("cityId", "City", cityOptions(cities, currentCity), { empty: "Not specified" })}
        {values.cityId === OTHER_CITY ? text("cityOther", "City name", { required: true, placeholder: "e.g. Murree" }) : null}
        {profileExtra}
      </FormSection>
    </div>
  );
}
