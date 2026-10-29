"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { FormSection, selectClass } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import { DIMENSION_FIELD, SALE_MODELS, SALE_MODEL_LABELS, type DimensionKey } from "@/modules/inventory/constants";
import type { ProjectDimensions } from "@/server/db/schema";
import { createUnitAction, updateUnitAction } from "../actions";

export type UnitFormValues = {
  projectId: string;
  unitNo: string;
  floor: string;
  block: string;
  saleModel: string;
  areaSqft: string;
  basePrice: string;
  nature: string;
  category: string;
  type: string;
  bedrooms: string;
  premium: string;
  listedOn: string;
  comment: string;
};

type ProjectOption = { id: string; label: string; dimensionConfig: ProjectDimensions };

/**
 * FR-070 unit fields in the Leads form-section style. Dimension fields become selects when the
 * project defines a list for them (FR-061), free text otherwise. Create mode redirects to the unit.
 */
export function UnitForm({
  unitId,
  initial,
  projects,
  disabled = false,
}: {
  unitId?: string;
  initial: UnitFormValues;
  projects: ProjectOption[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const set = (patch: Partial<UnitFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const off = disabled || pending;
  const dimensions = projects.find((p) => p.id === values.projectId)?.dimensionConfig ?? {};

  const submit = () =>
    startTransition(async () => {
      setMsg(null);
      if (!unitId) {
        const result = await createUnitAction(values);
        if (result.ok) return router.push(`/dashboard/inventory/${result.data.unitId}`);
        setErrors(result.fields ?? {});
        setMsg({ text: result.message, ok: false });
        return;
      }
      // A unit's project is fixed once created; the edit sends the unit fields only.
      const edit: Partial<UnitFormValues> = { ...values };
      delete edit.projectId;
      const result = await updateUnitAction(unitId, edit);
      if (result.ok) {
        setErrors({});
        setMsg({ text: result.data.changed.length ? "Changes saved." : "Nothing changed.", ok: true });
      } else {
        setErrors(result.fields ?? {});
        setMsg({ text: result.message, ok: false });
      }
    });

  const text = (key: keyof UnitFormValues, label: string, opts: { required?: boolean; placeholder?: string; inputMode?: "decimal" | "numeric"; type?: string } = {}) => (
    <Field label={label} required={opts.required} error={errors[key]}>
      {(id, describedBy) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          invalid={Boolean(errors[key])}
          type={opts.type ?? "text"}
          inputMode={opts.inputMode}
          value={values[key]}
          placeholder={opts.placeholder}
          autoComplete="off"
          disabled={off}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      )}
    </Field>
  );

  /** Select from the project's list when it has one; keeps a legacy value visible if it was removed from the list. */
  const dimension = (key: DimensionKey, label: string) => {
    const field = DIMENSION_FIELD[key];
    const list = dimensions[key] ?? [];
    if (list.length === 0) return text(field, label, { placeholder: "Optional" });
    const current = values[field];
    const options = current && !list.some((v) => v.toLowerCase() === current.toLowerCase()) ? [current, ...list] : list;
    return (
      <Field label={label} error={errors[field]} hint="From this project's inventory dimensions">
        {(id, describedBy) => (
          <select id={id} aria-describedby={describedBy} value={current} disabled={off} onChange={(e) => set({ [field]: e.target.value })} className={selectClass}>
            <option value="">Not set</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
      </Field>
    );
  };

  return (
    <form
      noValidate
      aria-label="Unit details"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      {!unitId && msg && !msg.ok ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {msg.text}
        </p>
      ) : null}
      <FormSection title="Unit">
        {unitId ? null : (
          <Field label="Project" required error={errors.projectId}>
            {(id, describedBy) => (
              <select id={id} aria-describedby={describedBy} value={values.projectId} disabled={off} onChange={(e) => set({ projectId: e.target.value })} className={selectClass}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {text("unitNo", "Unit number", { required: true, placeholder: "e.g. A-101" })}
        {dimension("floors", "Floor")}
        {dimension("blocks", "Block")}
        <Field label="Sale model" required error={errors.saleModel}>
          {(id, describedBy) => (
            <select id={id} aria-describedby={describedBy} value={values.saleModel} disabled={off} onChange={(e) => set({ saleModel: e.target.value })} className={selectClass}>
              {SALE_MODELS.map((m) => (
                <option key={m} value={m}>
                  {SALE_MODEL_LABELS[m]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </FormSection>
      <FormSection title="Size & price">
        {text("areaSqft", "Area (sq ft)", { required: true, inputMode: "decimal", placeholder: "e.g. 674" })}
        {text("basePrice", "Base price (PKR)", { required: true, inputMode: "decimal", placeholder: "e.g. 12,500,000" })}
      </FormSection>
      <FormSection title="Specification">
        {text("nature", "Nature", { placeholder: "e.g. Apartment" })}
        {dimension("categories", "Category")}
        {dimension("types", "Type")}
        {text("bedrooms", "Bedrooms", { inputMode: "numeric", placeholder: "Optional" })}
        {dimension("premiums", "Premium")}
        {text("listedOn", "Listed on", { type: "date" })}
      </FormSection>
      <FormSection title="Comment">
        <Field label="Comment" error={errors.comment} className="sm:col-span-2">
          {(id, describedBy) => (
            <textarea id={id} aria-describedby={describedBy} rows={3} value={values.comment} onChange={(e) => set({ comment: e.target.value })} placeholder="Optional" className={textareaClass} disabled={off} />
          )}
        </Field>
      </FormSection>

      {disabled ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {unitId && msg ? (
            <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
              {msg.text}
            </p>
          ) : null}
          {unitId ? (
            <Button
              variant="secondary"
              size="lg"
              disabled={!dirty || pending}
              onClick={() => {
                setValues(initial);
                setErrors({});
                setMsg(null);
              }}
            >
              Cancel
            </Button>
          ) : (
            <Link href="/dashboard/inventory" className={buttonClasses({ variant: "secondary", size: "lg" })}>
              Cancel
            </Link>
          )}
          <Button type="submit" variant="primary" size="lg" disabled={pending || (Boolean(unitId) && !dirty)} className="px-5">
            {pending ? "Saving…" : unitId ? "Save changes" : "Create unit"}
          </Button>
        </div>
      )}
    </form>
  );
}
