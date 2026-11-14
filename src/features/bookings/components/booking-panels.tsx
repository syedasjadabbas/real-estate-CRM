"use client";

import { useState, useTransition } from "react";
import { StageSteps, type StageFile } from "./stage-steps";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { selectClass } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import { BOOKING_STAGE_LABELS, PAYMENT_DOCS_LABELS, PAYMENT_DOCS_STATUSES, type BookingStage } from "@/modules/bookings/constants";
import type { BookingDetail } from "@/modules/bookings/queries";
import { cancelBookingAction, updateBookingAction } from "../actions";

function Status({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
      {msg.text}
    </p>
  );
}

/** Next-stage move (one step, optional note) and cancel with a required reason. */
export function BookingStagePanel({ detail, signedForms = [], proofs = [] }: { detail: BookingDetail; signedForms?: StageFile[]; proofs?: StageFile[] }) {
  const { booking, permissions } = detail;
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [cancelError, setCancelError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const next = permissions.nextStage as BookingStage | null;
  const closed = booking.stage === "confirmed" || booking.stage === "cancelled";

  return (
    <PanelCard title="Stage">
      <div className="space-y-4">
        {closed ? (
          <p className="text-xs text-zinc-600">
            This booking is {BOOKING_STAGE_LABELS[booking.stage].toLowerCase()}
            {booking.stage === "cancelled" && booking.cancelledReason ? `: ${booking.cancelledReason}` : "."}
          </p>
        ) : (
          // Every open stage shows its steps; only the move itself depends on the role (owner, 14 Nov 2026).
          <StageSteps
            bookingId={booking.id}
            stage={booking.stage}
            next={next}
            canAdvance={permissions.advance}
            stageChangedAt={booking.stageChangedAt}
            signedForms={signedForms}
            proofs={proofs}
          />
        )}

        {permissions.cancel ? (
          <div className="space-y-2 border-t border-zinc-100 pt-4">
            <p className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Cancel booking</p>
            <Field label="Reason" required error={cancelError}>
              {(id, describedBy) => (
                <textarea
                  id={id}
                  aria-describedby={describedBy}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Token not paid by the hold date"
                  className={textareaClass}
                  disabled={pending}
                />
              )}
            </Field>
            <Button
              variant="secondary"
              size="lg"
              className="border-rose-200 text-rose-700 hover:bg-rose-50"
              disabled={!reason.trim() || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await cancelBookingAction(booking.id, reason);
                  if (result.ok) {
                    setReason("");
                    setCancelError(undefined);
                    setMsg({ text: "Booking cancelled. The unit is available again.", ok: true });
                  } else {
                    setCancelError(result.fields?.reason);
                    setMsg({ text: result.message, ok: false });
                  }
                })
              }
            >
              Cancel booking
            </Button>
          </div>
        ) : null}
        <Status msg={msg} />
      </div>
    </PanelCard>
  );
}

/** Overview fields managers / admins keep up to date (rate and token are fixed after creation). */
export function BookingDetailsPanel({ detail }: { detail: BookingDetail }) {
  const { booking } = detail;
  const initial = {
    reservedUntil: booking.reservedUntil ?? "",
    agreementSentOn: booking.agreementSentOn ?? "",
    paymentDocsStatus: booking.paymentDocsStatus as string,
    paymentInstructions: booking.paymentInstructions ?? "",
  };
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));

  return (
    <PanelCard title="Overview details">
      <div className="space-y-3">
        <Field label="Reserved until" error={errors.reservedUntil}>
          {(id, d) => <Input id={id} aria-describedby={d} type="date" value={values.reservedUntil} onChange={(e) => set({ reservedUntil: e.target.value })} disabled={pending} />}
        </Field>
        <Field label="Agreement sent on" error={errors.agreementSentOn}>
          {(id, d) => <Input id={id} aria-describedby={d} type="date" value={values.agreementSentOn} onChange={(e) => set({ agreementSentOn: e.target.value })} disabled={pending} />}
        </Field>
        <Field label="Payment docs" error={errors.paymentDocsStatus}>
          {(id, d) => (
            <select id={id} aria-describedby={d} value={values.paymentDocsStatus} onChange={(e) => set({ paymentDocsStatus: e.target.value })} className={selectClass} disabled={pending}>
              {PAYMENT_DOCS_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PAYMENT_DOCS_LABELS[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Payment instructions (shown to buyer)" error={errors.paymentInstructions}>
          {(id, d) => (
            <textarea id={id} aria-describedby={d} rows={3} value={values.paymentInstructions} onChange={(e) => set({ paymentInstructions: e.target.value })} className={textareaClass} disabled={pending} />
          )}
        </Field>
        <Button
          variant="primary"
          size="lg"
          disabled={!dirty || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await updateBookingAction(booking.id, values);
              if (result.ok) {
                setErrors({});
                setMsg({ text: result.data.changed.length ? "Changes saved." : "Nothing changed.", ok: true });
              } else {
                setErrors(result.fields ?? {});
                setMsg({ text: result.message, ok: false });
              }
            })
          }
        >
          Save details
        </Button>
        <Status msg={msg} />
      </div>
    </PanelCard>
  );
}
