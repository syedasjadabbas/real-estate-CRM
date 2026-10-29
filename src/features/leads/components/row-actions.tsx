"use client";

import { Check, Copy, Star } from "lucide-react";
import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { completeNextFollowUpAction, setFavoriteAction } from "../actions";
import { FollowUpDialog } from "./follow-up-dialog";

export function FavoriteButton({ leadId, initial, size = "sm" }: { leadId: string; initial: boolean; size?: "sm" | "md" }) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const toggle = () => {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const result = await setFavoriteAction(leadId, next);
      if (!result.ok) setOn(!next);
    });
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={on}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      title={on ? "Remove from favorites" : "Add to favorites"}
      className={cn(
        "inline-flex items-center justify-center rounded-lg transition-colors hover:bg-zinc-100",
        size === "sm" ? "size-6 p-1" : "size-9 border border-zinc-200/80 bg-white shadow-hairline",
      )}
    >
      <Star aria-hidden="true" className={cn("size-4", on ? "fill-amber-400 text-amber-500" : "text-zinc-300")} />
    </button>
  );
}

export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy lead code ${code}`}
      title="Copy code"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // Clipboard unavailable (insecure context): nothing to do.
        }
      }}
      className="inline-flex size-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
    >
      {copied ? <Check aria-hidden="true" className="size-3.5 text-brand" /> : <Copy aria-hidden="true" className="size-3.5" />}
    </button>
  );
}

/** ADD / DONE follow-up buttons in the leads table (reference "FOLLOW-UP" column). */
export function FollowUpButtons({ leadId, leadName, hasPending, disabled }: { leadId: string; leadName: string; hasPending: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const done = () =>
    startTransition(async () => {
      const result = await completeNextFollowUpAction(leadId);
      setError(result.ok ? null : result.message);
    });

  const base = "w-[72px] rounded-lg border px-2.5 py-1 text-[10px] leading-[13px] font-black tracking-[0.025em] uppercase transition-colors disabled:opacity-40";
  return (
    <div className="flex flex-col gap-1.5 py-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(base, "border-brand/30 bg-brand-50/50 text-brand-700 hover:bg-brand-50")}
      >
        Add
      </button>
      <button
        type="button"
        disabled={disabled || !hasPending || pending}
        onClick={done}
        title={hasPending ? "Complete the next follow-up" : "No pending follow-up"}
        className={cn(base, "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50")}
      >
        {pending ? "…" : "Done"}
      </button>
      {error ? <span role="alert" className="max-w-[72px] text-[10px] font-semibold text-rose-600">{error}</span> : null}
      <FollowUpDialog open={open} onClose={() => setOpen(false)} leadId={leadId} leadName={leadName} />
    </div>
  );
}
