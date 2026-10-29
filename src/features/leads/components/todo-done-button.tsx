"use client";

import { useState, useTransition } from "react";
import { completeFollowUpAction } from "../actions";

export function TodoDoneButton({ followUpId }: { followUpId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await completeFollowUpAction(followUpId);
            setError(result.ok ? null : result.message);
          })
        }
        className="rounded-lg border border-zinc-200/80 bg-white px-2.5 py-1 text-[10px] font-black tracking-[0.025em] text-zinc-700 uppercase hover:bg-zinc-50 disabled:opacity-50"
      >
        {pending ? "…" : "Done"}
      </button>
      {error ? (
        <span role="alert" className="text-[10px] font-semibold text-rose-600">
          {error}
        </span>
      ) : null}
    </>
  );
}
