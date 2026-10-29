"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { formatPrice } from "@/features/inventory/format";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { FormSection, selectClass } from "@/features/leads/components/lead-fields";
import { BOOKING_STAGE_LABELS } from "@/modules/bookings/constants";
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS } from "@/modules/finance/constants";
import type { PayableBooking } from "@/modules/finance/views";
import { recordPaymentAction } from "../actions";

/**
 * FR-202 record a payment. Shows total / paid / outstanding of the chosen booking before saving.
 * One idempotency key per form: a double click or retried submit posts a single payment.
 */
export function RecordPaymentForm({
  bookings,
  methods,
  defaultBookingId,
  today,
}: {
  bookings: PayableBooking[];
  methods: { id: string; name: string }[];
  defaultBookingId: string;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [key] = useState(() => `form-${crypto.randomUUID()}`);
  const [values, setValues] = useState({
    bookingId: bookings.some((b) => b.id === defaultBookingId) ? defaultBookingId : "",
    type: "",
    amount: "",
    receivedOn: today,
    methodId: "",
    reference: "",
    note: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  const booking = useMemo(() => bookings.find((b) => b.id === values.bookingId), [bookings, values.bookingId]);

  const submit = () =>
    startTransition(async () => {
      setFormError(null);
      const result = await recordPaymentAction({ ...values, idempotencyKey: key });
      if (result.ok) return router.push(`/dashboard/finance/payments/${result.data.paymentId}`);
      setErrors(result.fields ?? {});
      setFormError(result.message);
    });

  const select = (key: "bookingId" | "type" | "methodId", label: string, options: { value: string; label: string }[], empty: string) => (
    <Field label={label} required error={errors[key]} className={key === "bookingId" ? "sm:col-span-2" : undefined}>
      {(id, describedBy) => (
        <select id={id} aria-describedby={describedBy} value={values[key]} onChange={(e) => set({ [key]: e.target.value })} className={selectClass} disabled={pending}>
          <option value="">{empty}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
  const text = (key: "amount" | "receivedOn" | "reference", label: string, opts: { required?: boolean; type?: string; placeholder?: string }) => (
    <Field label={label} required={opts.required} error={errors[key]}>
      {(id, describedBy) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          invalid={Boolean(errors[key])}
          type={opts.type ?? "text"}
          inputMode={key === "amount" ? "decimal" : undefined}
          max={key === "receivedOn" ? today : undefined}
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
      aria-label="Record payment"
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
        {select(
          "bookingId",
          "Booking",
          bookings.map((b) => ({ value: b.id, label: `${b.leadName} (${b.leadCode}) · Unit ${b.unitNo} · ${b.projectName}` })),
          bookings.length ? "Select a booking…" : "No bookings can take a payment",
        )}
        {/* One column on phones so amounts are never cut off. */}
        <div className="grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-3" aria-live="polite">
          {[
            ["Total sale", booking ? formatPrice(booking.totalSale) : "—"],
            ["Paid", booking ? formatPrice(booking.paid) : "—"],
            ["Outstanding", booking ? formatPrice(booking.outstanding) : "—"],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-xl bg-zinc-50 px-3 py-2">
              <p className="text-[9px] leading-[13.5px] font-black tracking-[0.05em] text-zinc-400 uppercase">{label}</p>
              <p className="truncate text-sm font-black tabular-nums">{value}</p>
            </div>
          ))}
          {booking ? <p className="text-[11px] text-zinc-500 sm:col-span-3">Stage: {BOOKING_STAGE_LABELS[booking.stage]}</p> : null}
        </div>
      </FormSection>
      <FormSection title="Payment">
        {select("type", "Type", PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABELS[t] })), "Select…")}
        {text("amount", "Amount (PKR)", { required: true, placeholder: "e.g. 500,000" })}
        {text("receivedOn", "Received on", { required: true, type: "date" })}
        {select("methodId", "Method", methods.map((m) => ({ value: m.id, label: m.name })), "Select…")}
        {text("reference", "Reference", { placeholder: "Cheque / transaction no. (optional)" })}
        <Field label="Note" error={errors.note} className="sm:col-span-2">
          {(id, describedBy) => (
            <textarea id={id} aria-describedby={describedBy} rows={2} value={values.note} onChange={(e) => set({ note: e.target.value })} placeholder="Optional" className={textareaClass} disabled={pending} />
          )}
        </Field>
      </FormSection>
      <p className="text-[11px] text-zinc-500">Posted payments can&apos;t be edited or deleted. Mistakes are corrected with a reversal, which needs a manager or admin to approve.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Link href="/dashboard/finance" className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Cancel
        </Link>
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="px-5">
          {pending ? "Posting…" : "Post payment"}
        </Button>
      </div>
    </form>
  );
}
