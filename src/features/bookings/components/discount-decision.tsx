"use client";

import { Percent } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/features/inventory/format";
import { decideDiscountAction } from "../actions";

/**
 * Booking discount above the agent's cap (owner, 14 Nov 2026). While pending: what was asked and the
 * price held meanwhile, with Approve / Reject for Admins and Super Admins. Afterwards: the decision.
 */
export function DiscountBanner({
  bookingId,
  status,
  requestedPct,
  currentPct,
  totalSale,
  note,
  canDecide,
}: {
  bookingId: string;
  status: "none" | "pending" | "approved" | "rejected";
  requestedPct: number | null;
  currentPct: number;
  totalSale: number;
  note: string | null;
  canDecide: boolean;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (status === "none") return null;

  const decide = (approve: boolean) =>
    startTransition(async () => {
      if (!approve && !reason.trim()) {
        setError("Give a reason for rejecting.");
        return;
      }
      const r = await decideDiscountAction(bookingId, approve, reason);
      setError(r.ok ? null : r.message);
    });

  if (status === "pending") {
    return (
      <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-amber-900">
        <p className="flex items-center gap-2 text-sm font-black">
          <Percent aria-hidden="true" className="size-4" />
          Discount of {requestedPct}% waiting for approval
        </p>
        <p className="mt-1 text-xs font-semibold">
          Held at {currentPct}% ({formatPrice(totalSale)}) until an Admin or Super Admin decides. The booking can&apos;t move to the next stage until then.
        </p>
        {canDecide ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              aria-label="Reason for rejecting"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              placeholder="Reason (needed to reject)"
              className="h-9 min-w-0 flex-1 rounded-xl border border-amber-200 bg-white px-3 text-xs font-medium focus:border-brand/50 focus:outline-none"
            />
            <Button variant="primary" size="md" disabled={pending} onClick={() => decide(true)}>
              Approve {requestedPct}%
            </Button>
            <Button variant="secondary" size="md" disabled={pending} onClick={() => decide(false)}>
              Reject (keep {currentPct}%)
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">
            {error}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <p className={`rounded-2xl border px-4 py-3 text-xs font-semibold ${status === "approved" ? "border-brand/30 bg-brand-50 text-brand" : "border-zinc-200 bg-zinc-50 text-zinc-700"}`}>
      {status === "approved"
        ? `Discount of ${currentPct}% approved.`
        : `Discount of ${requestedPct}% rejected; the booking stays at ${currentPct}%.${note ? ` Reason: ${note}` : ""}`}
    </p>
  );
}
