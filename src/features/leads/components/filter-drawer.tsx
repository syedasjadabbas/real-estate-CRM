"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import {
  FOLLOW_UP_WINDOW_LABELS,
  FOLLOW_UP_WINDOWS,
  LEAD_STAGES,
  PRIORITIES,
  PRIORITY_LABELS,
  STAGE_LABELS,
} from "@/modules/leads/constants";
import type { LeadLookups } from "@/modules/leads/queries";
import { FILTER_KEYS } from "../url";

type Option = { value: string; label: string };

/** Multi-select rendered as toggle chips — every option is visible and keyboard reachable. */
function ChipGroup({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((v) => v !== option.value) : [...selected, option.value])}
              className={cn(
                "rounded-xl border px-2.5 py-1.5 text-xs font-bold transition-colors",
                on
                  ? "border-brand bg-brand text-white shadow-hairline"
                  : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const split = (v?: string) => (v ? v.split(",").filter(Boolean) : []);

/** Right-side filter drawer: "Changes apply immediately", Clear filters / Done (reference). */
export function LeadFilterDrawer({
  open,
  onClose,
  title,
  params,
  lookups,
  onApply,
  total,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  params: Record<string, string>;
  lookups: LeadLookups;
  onApply: (overrides: Record<string, string | null>) => void;
  total: number;
}) {
  const set = (key: string, values: string[] | string | null) =>
    onApply({ [key]: Array.isArray(values) ? values.join(",") || null : values });

  return (
    <Modal
      open={open}
      onClose={onClose}
      side="right"
      title={title}
      description="Refine the list. Changes apply immediately."
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onApply(Object.fromEntries(FILTER_KEYS.filter((k) => k !== "q").map((k) => [k, null])))}>
            Clear filters
          </Button>
          <Button variant="primary" size="lg" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <span className="inline-flex rounded-full border border-brand/30 bg-brand-50 px-2.5 py-1 text-[10px] font-black tracking-[0.05em] text-brand-700 uppercase">
          {formatInt(total)} leads
        </span>
        <ChipGroup
          label="Stages"
          options={LEAD_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
          selected={split(params.stage)}
          onChange={(v) => set("stage", v)}
        />
        <Field label="Follow-up">
          {(id) => (
            <div id={id} className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-1.5 shadow-hairline">
              <Select
                label="Follow-up window"
                options={[{ value: "", label: "Any" }, ...FOLLOW_UP_WINDOWS.map((w) => ({ value: w, label: FOLLOW_UP_WINDOW_LABELS[w] }))]}
                value={params.followUp ?? ""}
                onChange={(v) => set("followUp", v || null)}
                buttonClassName="h-9"
              />
            </div>
          )}
        </Field>
        <ChipGroup
          label="Source"
          options={lookups.sources.map((s) => ({ value: s.id, label: s.name }))}
          selected={split(params.source)}
          onChange={(v) => set("source", v)}
        />
        <ChipGroup
          label="Priority"
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
          selected={split(params.priority)}
          onChange={(v) => set("priority", v)}
        />
        <ChipGroup
          label="City"
          options={lookups.cities.map((c) => ({ value: c.id, label: c.name }))}
          selected={split(params.city)}
          onChange={(v) => set("city", v)}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Date field">
            {(id) => (
              <div id={id} className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-1.5 shadow-hairline">
                <Select
                  label="Date field"
                  options={[
                    { value: "created", label: "Created" },
                    { value: "updated", label: "Updated" },
                  ]}
                  value={params.dateField ?? "created"}
                  onChange={(v) => set("dateField", v === "created" ? null : v)}
                  buttonClassName="h-9"
                />
              </div>
            )}
          </Field>
          {(["from", "to"] as const).map((key) => (
            <Field key={key} label={key === "from" ? "From" : "To"}>
              {(id) => (
                <input
                  id={id}
                  type="date"
                  value={params[key] ?? ""}
                  onChange={(event) => set(key, event.target.value || null)}
                  className="h-[38px] w-full rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-2.5 text-sm font-medium shadow-hairline focus:border-brand/50 focus:outline-none"
                />
              )}
            </Field>
          ))}
        </div>
      </div>
    </Modal>
  );
}
