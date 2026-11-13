"use client";

import { cityOptions, OTHER_CITY } from "@/modules/cities/constants";
import type { ReactNode } from "react";
import { ExtraPhonesFields } from "@/features/contacts/components/extra-phones";
import type { ExtraPhoneInput } from "@/modules/contacts/constants";
import { Field, Input } from "@/components/ui/input";
import { PRIORITIES, PRIORITY_LABELS } from "@/modules/leads/constants";
import type { LeadLookups } from "@/modules/leads/queries";

export const COUNTRY_CODES = [
  { value: "+92", label: "+92 Pakistan" },
  { value: "+971", label: "+971 UAE" },
  { value: "+966", label: "+966 Saudi Arabia" },
  { value: "+974", label: "+974 Qatar" },
  { value: "+968", label: "+968 Oman" },
  { value: "+965", label: "+965 Kuwait" },
  { value: "+973", label: "+973 Bahrain" },
  { value: "+44", label: "+44 United Kingdom" },
  { value: "+1", label: "+1 USA / Canada" },
  { value: "+61", label: "+61 Australia" },
  { value: "+49", label: "+49 Germany" },
];

export type LeadFormValues = {
  name: string;
  phoneCountryCode: string;
  phoneNumber: string;
  email: string;
  gender: string;
  desiredSize: string;
  sourceId: string;
  budgetRangeId: string;
  priority: string;
  cityId: string;
  cityOther: string;
  /** Numbers 2–5. */
  phones: ExtraPhoneInput[];
};

type TextKey = Exclude<keyof LeadFormValues, "phones">;

export const selectClass =
  "h-10 w-full rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 text-sm font-medium text-zinc-900 shadow-hairline focus:border-brand/50 focus:bg-white focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60";

/** Form section card ("Contact", "Profile", "Interest & pipeline", "Location"). */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-hairline">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden="true" className="mb-3 text-[10px] font-black tracking-[0.2em] text-brand uppercase">
        {title}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

type Props = {
  values: LeadFormValues;
  onChange: (patch: Partial<LeadFormValues>) => void;
  errors: Record<string, string>;
  lookups: LeadLookups;
  disabled?: boolean;
  /** Extra controls appended to the Interest section (project, owner). */
  interestExtra?: ReactNode;
  /** The record's saved list city, kept as an option if it has since been deactivated. */
  currentCity?: { id: string; name: string | null } | null;
  /** The lead's project, for the Size dropdown's unit sizes. */
  projectId?: string;
};

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

export const sizeLabel = (areaSqft: number) => `${Number(areaSqft).toLocaleString("en-US", { maximumFractionDigits: 2 })} sq ft`;

/** A saved value that is no longer offered (typed before the dropdown) stays selectable. */
function withCurrent(options: { value: string; label: string }[], current: string) {
  return current && !options.some((o) => o.value === current) ? [...options, { value: current, label: current }] : options;
}

/** Lead fields shared by the create form and the detail page's edit form. */
export function LeadFields({ values, onChange, errors, lookups, disabled, interestExtra, currentCity, projectId }: Props) {
  const sizeOptions = [...new Set(lookups.unitSizes.filter((u) => !projectId || u.projectId === projectId).map((u) => Number(u.areaSqft)))]
    .sort((a, b) => a - b)
    .map((a) => ({ value: sizeLabel(a), label: sizeLabel(a) }));
  const text = (key: TextKey, label: string, opts: { required?: boolean; type?: string; placeholder?: string; autoComplete?: string } = {}) => (
    <Field label={label} required={opts.required} error={errors[key]}>
      {(id, describedBy) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          invalid={Boolean(errors[key])}
          type={opts.type ?? "text"}
          value={values[key]}
          placeholder={opts.placeholder}
          autoComplete={opts.autoComplete}
          disabled={disabled}
          onChange={(e) => onChange({ [key]: e.target.value })}
        />
      )}
    </Field>
  );
  const select = (key: TextKey, label: string, options: { value: string; label: string }[], opts: { required?: boolean; empty?: string } = {}) => (
    <Field label={label} required={opts.required} error={errors[key]}>
      {(id, describedBy) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={Boolean(errors[key]) || undefined}
          value={values[key]}
          disabled={disabled}
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
        {text("name", "Name", { required: true, autoComplete: "off" })}
        {text("email", "Email", { type: "email", placeholder: "Optional" })}
        {select("phoneCountryCode", "Country code", COUNTRY_CODES, { required: true })}
        {text("phoneNumber", "Mobile number", { required: true, type: "tel", placeholder: "3001234567 or 0300 1234567" })}
      </FormSection>
      <ExtraPhonesFields phones={values.phones} onChange={(phones) => onChange({ phones })} errors={errors} disabled={disabled} />
      <FormSection title="Profile">
        {select("gender", "Gender", withCurrent(GENDERS, values.gender), { empty: "Not specified" })}
        {select("desiredSize", "Size", withCurrent(sizeOptions, values.desiredSize), { empty: sizeOptions.length ? "Not specified" : "No unit sizes in inventory yet" })}
      </FormSection>
      <FormSection title="Interest & pipeline">
        {select("sourceId", "Source", lookups.sources.map((s) => ({ value: s.id, label: s.name })), { required: true, empty: "Select…" })}
        {select("budgetRangeId", "Budget", lookups.budgets.map((b) => ({ value: b.id, label: b.name })), { empty: "Not specified" })}
        {select("priority", "Priority", PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })))}
        {interestExtra}
      </FormSection>
      <FormSection title="Location">
        {select("cityId", "City", cityOptions(lookups.cities, currentCity), { empty: "Not specified" })}
        {values.cityId === OTHER_CITY ? text("cityOther", "City name", { required: true, placeholder: "e.g. Murree", autoComplete: "off" }) : null}
      </FormSection>
    </div>
  );
}
