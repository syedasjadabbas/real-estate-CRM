"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/input";
import { extraPhoneProblem, isPhoneTooLong, phoneExample, phoneProblem } from "@/modules/leads/input-rules";

/**
 * A phone number checked against its country while it is typed (client, 25 Nov 2026): at once when it has too
 * many digits, otherwise on leaving the field or changing the country. A saved number is left alone until touched.
 */
export function PhoneInput({
  label,
  countryCode,
  value,
  onChange,
  error,
  disabled,
  extra = false,
}: {
  label: string;
  countryCode: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  /** An optional further number, which may be a landline. */
  extra?: boolean;
}) {
  const [edited, setEdited] = useState(false);
  const [left, setLeft] = useState(false);
  // What the form said about this country and number; once either changes, only the live check speaks.
  const [told, setTold] = useState<{ error?: string; of: string }>({ of: "" });
  const now = `${countryCode} ${value}`;
  if (error !== told.error) setTold({ error, of: now });
  const problem = value.trim() ? (extra ? extraPhoneProblem : phoneProblem)(countryCode, value) : null;
  const live = edited && problem && (left || isPhoneTooLong(countryCode, value)) ? problem : null;
  const shown = live ?? (error && (told.error !== error || told.of === now || problem) ? (told.of === now ? error : (problem ?? error)) : undefined);
  const good = edited && Boolean(value.trim()) && !problem && !shown;
  return (
    <Field label={label} required={!extra} error={shown} hint={good ? "Valid number" : undefined}>
      {(id, describedBy) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          invalid={Boolean(shown)}
          type="tel"
          inputMode="tel"
          maxLength={25}
          value={value}
          placeholder={extra ? "Optional" : `e.g. ${phoneExample(countryCode)}`}
          autoComplete="off"
          disabled={disabled}
          onBlur={() => setLeft(true)}
          onChange={(e) => {
            setEdited(true);
            onChange(e.target.value.replace(/[^\d\s+()-]/g, ""));
          }}
        />
      )}
    </Field>
  );
}
