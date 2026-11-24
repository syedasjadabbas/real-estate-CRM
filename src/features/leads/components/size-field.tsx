"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/input";
import { formatSqft, parseSize, SIZE_PRESETS, SIZE_UNITS, type SizeUnit } from "@/modules/leads/size";
import { selectClass } from "./lead-fields";

const OTHER = "__other";

/** Size as a choice, not free text: the campaign sizes, the project's unit sizes, or a number with its unit. */
export function SizeField({
  value,
  onChange,
  unitSizes,
  marlaSqft,
  error,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  unitSizes: string[];
  marlaSqft: number;
  error?: string;
  disabled?: boolean;
}) {
  const options = [...SIZE_PRESETS, ...unitSizes];
  const parsed = value ? parseSize(value, marlaSqft) : null;
  const listed = options.includes(value);
  const [custom, setCustom] = useState(false);
  const single = parsed?.parts.length === 1 ? parsed.parts[0] : null;
  const [number, setNumber] = useState(single ? String(single.value) : "");
  const [unit, setUnit] = useState<SizeUnit>(single?.unit ?? "marla");
  const compose = (n: string, u: SizeUnit) => onChange(Number(n) > 0 ? `${Number(n)} ${u}` : "");
  const hint = parsed ? `= ${formatSqft(parsed.sqft)}` : value && !custom ? "Unclear: ask the customer and choose a size" : undefined;
  return (
    <>
      <Field label="Size" error={error} hint={hint}>
        {(id, d) => (
          <select
            id={id}
            aria-describedby={d}
            className={selectClass}
            disabled={disabled}
            value={custom ? OTHER : value}
            onChange={(e) => {
              if (e.target.value === OTHER) {
                setCustom(true);
                compose(number, unit);
              } else {
                setCustom(false);
                onChange(e.target.value);
              }
            }}
          >
            <option value="">Not specified</option>
            {SIZE_PRESETS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {unitSizes.length ? (
              <optgroup label="Sizes in this project">
                {unitSizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {value && !listed ? (
              <option value={value}>
                {value}
                {parsed ? "" : " (unclear)"}
              </option>
            ) : null}
            <option value={OTHER}>Other size…</option>
          </select>
        )}
      </Field>
      {custom ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Number">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={number}
                disabled={disabled}
                onChange={(e) => {
                  const n = e.target.value.replace(/[^\d.]/g, "");
                  setNumber(n);
                  compose(n, unit);
                }}
              />
            )}
          </Field>
          <Field label="Unit">
            {(id) => (
              <select
                id={id}
                className={selectClass}
                value={unit}
                disabled={disabled}
                onChange={(e) => {
                  const u = e.target.value as SizeUnit;
                  setUnit(u);
                  compose(number, u);
                }}
              >
                {SIZE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      ) : null}
    </>
  );
}
