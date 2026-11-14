"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { rejectBookingPaymentAction } from "../actions";

/**
 * Accounts verify a new booking's token (owner, 14 Nov 2026): record the payment if it is genuine, or
 * reject the booking with a reason (cancels it, frees the unit, tells the agent).
 */
export function RejectPaymentPanel({ bookingId }: { bookingId: string }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <PanelCard title="Verify token payment">
      <div className="space-y-3">
        <p className="text-xs text-zinc-600">Check the agent&apos;s proof against the bank or cash. If the money is real, record it; if not, reject the booking.</p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/dashboard/finance/record?booking=${bookingId}`} className={buttonClasses({ variant: "primary", size: "lg" })}>
            Payment is real: record it →
          </Link>
          <Button variant="secondary" size="lg" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setOpen((v) => !v)} disabled={pending}>
            Not genuine: reject
          </Button>
        </div>
        {open ? (
          <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
            <label className="block text-[10px] font-black tracking-[0.1em] text-rose-800 uppercase" htmlFor={`reject-${bookingId}`}>
              Why is it rejected?
            </label>
            <textarea
              id={`reject-${bookingId}`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. No transfer received in the bank; screenshot does not match"
              className={textareaClass}
              disabled={pending}
            />
            <Button
              variant="primary"
              size="lg"
              className="bg-rose-600 hover:bg-rose-700"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                startTransition(async () => {
                  const r = await rejectBookingPaymentAction(bookingId, reason);
                  setMsg(r.ok ? { text: "Booking rejected and cancelled. The unit is available again and the agent was told.", ok: true } : { text: r.message, ok: false });
                })
              }
            >
              {pending ? "Rejecting…" : "Reject booking"}
            </Button>
            <p className="text-[11px] text-rose-800">This cancels the booking and frees the unit. It can&apos;t be undone.</p>
          </div>
        ) : null}
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-xs font-semibold text-brand" : "text-xs font-semibold text-rose-600"}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </PanelCard>
  );
}
