"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { decideLostAction } from "../actions";

/** Approve / Reject a pending lost request (managers and admins). */
export function ApprovalActions({ approvalId }: { approvalId: string }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const decide = (approve: boolean) =>
    startTransition(async () => {
      const result = await decideLostAction(approvalId, approve, comment);
      setError(result.ok ? null : result.message);
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`comment-${approvalId}`}>
        Decision comment
      </label>
      <input
        id={`comment-${approvalId}`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (optional)"
        className="h-9 min-w-0 flex-1 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 text-xs font-medium shadow-hairline focus:border-brand/50 focus:outline-none"
      />
      <Button variant="primary" size="md" disabled={pending} onClick={() => decide(true)}>
        Approve lost
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
