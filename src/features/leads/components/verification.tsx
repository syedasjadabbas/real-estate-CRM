"use client";

import { CircleCheck, Clock, RotateCcw, ShieldAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { LeadDetail } from "@/modules/leads/queries";
import { resubmitLeadAction, verifyLeadAction } from "../actions";
import { formatDateTime } from "../format";

/**
 * Approve, or reject with a reason, a lead an agent added (Admin and Super Admin). Used on the
 * lead page and in the Verify list.
 */
export function VerifyActions({ leadId, compact = false }: { leadId: string; compact?: boolean }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const decide = (approve: boolean) =>
    startTransition(async () => {
      if (!approve && !note.trim()) {
        setError("Give a reason for rejecting the lead.");
        return;
      }
      const result = await verifyLeadAction(leadId, approve, note);
      setError(result.ok ? null : result.message);
    });

  return (
    <div className={cn("flex flex-wrap items-center gap-2", compact ? "" : "mt-3")}>
      <label className="sr-only" htmlFor={`verify-note-${leadId}`}>
        Reason for rejecting
      </label>
      <input
        id={`verify-note-${leadId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        placeholder="Reason (needed to reject)"
        className="h-9 min-w-0 flex-1 rounded-xl border border-zinc-200/80 bg-white px-3 text-xs font-medium shadow-hairline focus:border-brand/50 focus:outline-none"
      />
      <Button variant="primary" size="md" disabled={pending} onClick={() => decide(true)}>
        Approve
      </Button>
      <Button variant="secondary" size="md" disabled={pending} onClick={() => decide(false)}>
        Reject
      </Button>
      {error ? (
        <p role="alert" className="w-full text-xs font-semibold text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ResubmitButton({ leadId }: { leadId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        size="md"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await resubmitLeadAction(leadId);
            setError(result.ok ? null : result.message);
          })
        }
      >
        <RotateCcw aria-hidden="true" className="size-4" />
        {pending ? "Sending…" : "Resubmit for verification"}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-xs font-semibold text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Shown on the lead page while a lead waits for verification or was rejected. */
export function VerificationBanner({
  leadId,
  verification,
  canVerify,
  canResubmit,
}: {
  leadId: string;
  verification: LeadDetail["verification"];
  canVerify: boolean;
  canResubmit: boolean;
}) {
  if (verification.status === "approved") return null;
  if (verification.status === "pending") {
    return (
      <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-amber-900">
        <p className="flex items-center gap-2 text-sm font-black">
          <Clock aria-hidden="true" className="size-4" />
          Waiting for verification
        </p>
        <p className="mt-1 text-xs font-semibold">
          {canVerify
            ? "An agent added this lead. Check the details, then approve it so the agent can work on it, or reject it with a reason."
            : "An Admin or Super Admin checks every lead an agent adds. You can work on it once it is approved."}
        </p>
        {canVerify ? <VerifyActions leadId={leadId} /> : null}
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-rose-900">
      <p className="flex items-center gap-2 text-sm font-black">
        <ShieldAlert aria-hidden="true" className="size-4" />
        Rejected in verification
      </p>
      {verification.note ? <p className="mt-1 text-sm font-semibold">Reason: {verification.note}</p> : null}
      <p className="mt-1 text-xs font-semibold">
        {verification.verifiedByName ? `By ${verification.verifiedByName}` : null}
        {verification.verifiedAt ? ` · ${formatDateTime(verification.verifiedAt)}` : null}
        {canResubmit ? `${verification.verifiedByName || verification.verifiedAt ? ". " : ""}Correct the details below, then resubmit the lead.` : null}
      </p>
      {canResubmit ? <ResubmitButton leadId={leadId} /> : null}
    </div>
  );
}

/** Small badge for lead lists and cards; nothing for approved leads. */
export function VerificationBadge({ status }: { status: "pending" | "approved" | "rejected" }) {
  if (status === "approved") return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black tracking-[0.04em] uppercase",
        status === "pending" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-700",
      )}
    >
      {status === "pending" ? <Clock aria-hidden="true" className="size-3" /> : <CircleCheck aria-hidden="true" className="size-3 rotate-180" />}
      {status === "pending" ? "To verify" : "Rejected"}
    </span>
  );
}
