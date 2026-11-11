"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { formatArea, formatPrice } from "@/features/inventory/format";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { FormSection, selectClass } from "@/features/leads/components/lead-fields";
import { HOLD_DAYS } from "@/modules/bookings/constants";
import { createBookingAction } from "../actions";

type Options = {
  projects: { id: string; name: string }[];
  leads: { id: string; name: string; code: string }[];
  units: { id: string; unitNo: string; floor: string | null; areaSqft: number }[];
};

/**
 * FR-080 new booking as observed: Project*, Lead*, Unit (available)*, Per sq ft rate*, Token amount*,
 * payment instructions; plus Reserved until (hold date; blank = 7 days, FR-081). Total = area × rate (approved).
 */
export function BookingForm({ projectId, defaultLeadId, options }: { projectId: string; defaultLeadId: string; options: Options }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState({
    leadId: options.leads.some((l) => l.id === defaultLeadId) ? defaultLeadId : "",
    unitId: "",
    ratePerSqft: "",
    tokenAmount: "",
    reservedUntil: "",
    paymentInstructions: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));

  const unit = options.units.find((u) => u.id === values.unitId);
  const rate = Number(values.ratePerSqft.replace(/,/g, ""));
  const total = unit && rate > 0 ? Math.round(unit.areaSqft * rate * 100) / 100 : null;

  const submit = () =>
    startTransition(async () => {
      setFormError(null);
      const result = await createBookingAction({ ...values, projectId });
      if (result.ok) return router.push(`/dashboard/bookings/${result.data.bookingId}`);
      setErrors(result.fields ?? {});
      setFormError(result.message);
    });

  const select = (key: "leadId" | "unitId", label: string, list: { value: string; label: string }[], empty: string) => (
    <Field label={label} required error={errors[key]}>
      {(id, describedBy) => (
        <select id={id} aria-describedby={describedBy} value={values[key]} onChange={(e) => set({ [key]: e.target.value })} className={selectClass} disabled={pending}>
          <option value="">{empty}</option>
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
  const text = (key: "ratePerSqft" | "tokenAmount" | "reservedUntil", label: string, opts: { required?: boolean; type?: string; placeholder?: string; hint?: string }) => (
    <Field label={label} required={opts.required} error={errors[key]} hint={opts.hint}>
      {(id, describedBy) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          invalid={Boolean(errors[key])}
          type={opts.type ?? "text"}
          inputMode={opts.type ? undefined : "decimal"}
          value={values[key]}
          placeholder={opts.placeholder}
          autoComplete="off"
          disabled={pending}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      )}
    </Field>
  );

  return (
    <form
      noValidate
      aria-label="New booking"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      {formError ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {formError}
        </p>
      ) : null}
      <FormSection title="Booking">
        <Field label="Project" required>
          {(id) => (
            <select
              id={id}
              value={projectId}
              onChange={(e) => router.replace(`${pathname}?project=${e.target.value}`)}
              className={selectClass}
              disabled={pending}
            >
              {options.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        {select(
          "leadId",
          "Lead",
          options.leads.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` })),
          options.leads.length ? "Select a lead…" : "No eligible leads in this project",
        )}
        {select(
          "unitId",
          "Unit (available)",
          options.units.map((u) => ({ value: u.id, label: `${u.unitNo}${u.floor ? ` · ${u.floor}` : ""} · ${formatArea(u.areaSqft)}` })),
          options.units.length ? "Select an available unit…" : "No available whole units",
        )}
        {text("reservedUntil", "Reserved until", { type: "date", hint: `Leave blank for ${HOLD_DAYS} days from today. If no payment is recorded by then, the booking is cancelled and the unit becomes Available.` })}
      </FormSection>
      <FormSection title="Price">
        {text("ratePerSqft", "Per sq ft rate (PKR)", { required: true, placeholder: "e.g. 25,000" })}
        {text("tokenAmount", "Token amount (PKR)", { required: true, placeholder: "e.g. 500,000" })}
        <div className="rounded-xl bg-zinc-50 px-3 py-2 sm:col-span-2" aria-live="polite">
          <p className="text-[9px] leading-[13.5px] font-black tracking-[0.05em] text-zinc-400 uppercase">Total sale (area × rate)</p>
          <p className="text-lg leading-[18px] font-black tabular-nums">{total === null ? "—" : formatPrice(total)}</p>
        </div>
      </FormSection>
      <FormSection title="Payment instructions">
        <Field label="Payment instructions for buyer" error={errors.paymentInstructions} className="sm:col-span-2">
          {(id, describedBy) => (
            <textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              value={values.paymentInstructions}
              onChange={(e) => set({ paymentInstructions: e.target.value })}
              placeholder="Shown to the buyer"
              className={textareaClass}
              disabled={pending}
            />
          )}
        </Field>
      </FormSection>
      <div className="flex flex-wrap justify-end gap-2">
        <Link href="/dashboard/bookings" className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Cancel
        </Link>
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="px-5">
          {pending ? "Creating…" : "Create booking"}
        </Button>
      </div>
    </form>
  );
}
