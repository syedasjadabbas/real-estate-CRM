"use client";

import { AlertCircle } from "lucide-react";
import { planSummary, type PaymentPlan } from "@/modules/projects/payment-plan";
import { LeadPicker } from "@/features/leads/components/lead-picker";
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
  /** `listRate`: the unit's inventory rate per sq ft (null when it has no price and no default rate is set). */
  units: { id: string; unitNo: string; floor: string | null; areaSqft: number; basePrice: number; listRate: number | null }[];
  /** Highest discount this person may give, in % (agents 5%, Admins any). */
  discountCap: number;
  /** The project's payment plan (owner, 14 Nov 2026). */
  plan: PaymentPlan;
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
    discountPct: "",
    tokenAmount: "",
    reservedUntil: "",
    paymentInstructions: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // The token's proof (transfer screenshot, cheque or cash photo), attached with the booking (14 Nov 2026).
  const [proof, setProof] = useState<File | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));

  const unit = options.units.find((u) => u.id === values.unitId);
  // Price from inventory (owner, 14 Nov 2026): the unit's rate, less the discount; typed only when the unit has no price.
  const listRate = unit?.listRate ?? null;
  // From the unit's total price when it has one, as the server does, so 0% is exactly the inventory price.
  const listTotal = unit && listRate !== null ? (unit.basePrice > 0 ? unit.basePrice : Math.round(unit.areaSqft * listRate * 100) / 100) : null;
  const discount = Math.min(Math.max(Number(values.discountPct) || 0, 0), 100);
  const overCap = discount > options.discountCap;
  const total =
    unit && listTotal !== null
      ? Math.round(listTotal * (1 - discount / 100) * 100) / 100
      : unit && Number(values.ratePerSqft.replace(/,/g, "")) > 0
        ? Math.round(unit.areaSqft * Number(values.ratePerSqft.replace(/,/g, "")) * 100) / 100
        : null;
  const rate = unit && total !== null ? Math.round((total / unit.areaSqft) * 100) / 100 : 0;
  // Above the cap: the booking starts at the cap and the asked % goes to an Admin or Super Admin.
  const heldTotal = overCap && listTotal !== null ? Math.round(listTotal * (1 - options.discountCap / 100) * 100) / 100 : null;

  const submit = () =>
    startTransition(async () => {
      setFormError(null);
      // Payment proof is compulsory (owner, 14 Nov 2026).
      if (!proof) {
        setProofError("Attach the token payment proof: transfer screenshot, cheque or cash photo.");
        setFormError("Check the highlighted fields.");
        return;
      }
      const { discountPct, ratePerSqft, ...rest } = values;
      // With an inventory price only the discount is sent; the server works out the rate and checks the cap.
      const result = await createBookingAction(
        listRate !== null ? { ...rest, projectId, discountPct: discountPct || "0" } : { ...rest, projectId, ratePerSqft },
      );
      if (result.ok) {
        const bookingId = result.data.bookingId;
        if (proof) {
          // Same upload as the booking page's Payment proofs card; a failure still keeps the booking.
          const body = new FormData();
          body.set("file", proof);
          const res = await fetch(`/api/v1/bookings/${bookingId}/proofs`, { method: "POST", body }).catch(() => null);
          if (!res?.ok) return router.push(`/dashboard/bookings/${bookingId}?proof=failed`);
        }
        return router.push(`/dashboard/bookings/${bookingId}`);
      }
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
        <Field label="Lead" required error={errors.leadId}>
          {(id, describedBy) => (
            <LeadPicker
              id={id}
              describedBy={describedBy}
              value={values.leadId}
              onChange={(leadId) => set({ leadId })}
              options={options.leads.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))}
              empty={options.leads.length ? "Select a lead…" : "No eligible leads in this project"}
              disabled={pending}
            />
          )}
        </Field>
        {select(
          "unitId",
          "Unit (available)",
          options.units.map((u) => ({ value: u.id, label: `${u.unitNo}${u.floor ? ` · ${u.floor}` : ""} · ${formatArea(u.areaSqft)}` })),
          options.units.length ? "Select an available unit…" : "No available whole units",
        )}
        {text("reservedUntil", "Reserved until", { type: "date", hint: `Leave blank for ${HOLD_DAYS} days from today. If no payment is recorded by then, the booking is cancelled and the unit becomes Available.` })}
      </FormSection>
      <FormSection title="Price">
        {unit && listRate === null ? (
          text("ratePerSqft", "Per sq ft rate (PKR)", { required: true, placeholder: "e.g. 25,000", hint: "This unit has no price in inventory, so enter the rate." })
        ) : (
          <div className="rounded-xl bg-zinc-50 px-3 py-2">
            <p className="text-[9px] leading-[13.5px] font-black tracking-[0.05em] text-zinc-400 uppercase">Inventory price</p>
            <p className="text-lg leading-[18px] font-black tabular-nums">{listTotal === null ? "Pick a unit" : formatPrice(listTotal)}</p>
            <p className="text-[11px] text-zinc-500">{listRate === null ? "Filled from inventory" : `${formatPrice(listRate)} per sq ft · ${formatArea(unit!.areaSqft)}`}</p>
          </div>
        )}
        <Field
          label="Discount %"
          error={errors.discountPct}
          hint={options.discountCap >= 100 ? "Any discount" : `Up to ${options.discountCap}%`}
        >
          {(id, describedBy) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={Boolean(errors.discountPct)}
              inputMode="decimal"
              value={values.discountPct}
              placeholder="0"
              disabled={pending || !unit || listRate === null}
              onChange={(e) => set({ discountPct: e.target.value.replace(/[^\d.]/g, "").slice(0, 6) })}
            />
          )}
        </Field>
        {text("tokenAmount", "Token amount (PKR)", { required: true, placeholder: "e.g. 500,000", hint: "At least PKR 20,000. Accounts verify it before the booking goes ahead." })}
        <Field label="Token payment proof" required error={proofError ?? undefined} hint="Transfer screenshot, cheque or cash photo (JPG, PNG or PDF, up to 10 MB).">
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,.docx,.xlsx"
              disabled={pending}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setProofError(f && f.size > 10 * 1024 * 1024 ? "The file is larger than 10 MB." : null);
                setProof(f && f.size <= 10 * 1024 * 1024 ? f : null);
              }}
              className="block w-full text-xs text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-200/80 file:bg-white file:px-3 file:py-2 file:text-xs file:font-bold file:text-zinc-800 hover:file:bg-zinc-50"
            />
          )}
        </Field>
        <div className="rounded-xl bg-brand-50 px-3 py-2 sm:col-span-2" aria-live="polite">
          <p className="text-[9px] leading-[13.5px] font-black tracking-[0.05em] text-zinc-500 uppercase">Total sale{discount > 0 && listRate !== null ? ` (after ${discount}% discount)` : ""}</p>
          <p className="text-xl leading-6 font-black tabular-nums text-brand">{total === null ? "—" : formatPrice(total)}</p>
          {heldTotal !== null ? (
            <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
              Above {options.discountCap}% needs approval from an Admin or Super Admin. The booking starts at {options.discountCap}% ({formatPrice(heldTotal)}) and moves to {discount}% once approved.
            </p>
          ) : null}
          {total !== null && listTotal !== null && discount > 0 ? (
            <p className="text-[11px] text-zinc-600">
              {formatPrice(rate)} per sq ft · you save the buyer {formatPrice(listTotal - total)}
            </p>
          ) : null}
          {errors.ratePerSqft ? <p className="text-[11px] font-semibold text-rose-600">{errors.ratePerSqft}</p> : null}
          {total !== null ? (
            // The project's payment plan on this price (owner, 14 Nov 2026).
            <div className="mt-2 border-t border-brand/20 pt-2 text-[11px] text-zinc-700">
              <p className="font-black tracking-[0.05em] text-zinc-500 uppercase">Payment plan · {planSummary(options.plan)}</p>
              <p className="mt-0.5 tabular-nums">
                Down payment {formatPrice(Math.round((total * options.plan.downPaymentPct) / 100))}
                {" · "}
                {options.plan.installmentCount} installments of{" "}
                {formatPrice(
                  Math.floor(
                    (total * (1 - (options.plan.downPaymentPct + options.plan.possessionPct + options.plan.balloonCount * options.plan.balloonPct) / 100)) /
                      Math.max(1, options.plan.installmentCount),
                  ),
                )}
                {options.plan.balloonCount ? ` · ${options.plan.balloonCount} balloons of ${formatPrice(Math.round((total * options.plan.balloonPct) / 100))}` : ""}
                {options.plan.possessionPct ? ` · on possession ${formatPrice(Math.round((total * options.plan.possessionPct) / 100))}` : ""}
              </p>
            </div>
          ) : null}
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
