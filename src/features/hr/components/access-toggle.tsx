"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { setAccountStatusAction } from "../actions";

/** One switch per person: on = their role's normal access, off = no access (signed out at once). */
export function AccessToggle({
  userId,
  name,
  active,
  disabled,
  disabledReason,
}: {
  userId: string;
  name: string;
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [on, setOn] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const flip = () => {
    const next = !on;
    if (!next && !window.confirm(`Turn off ${name}'s access? They are signed out now and can't sign in until you turn it back on.`)) return;
    setOn(next);
    setError(null);
    startTransition(async () => {
      const r = await setAccountStatusAction(userId, { status: next ? "active" : "inactive" });
      if (!r.ok) {
        setOn(!next);
        setError(r.message);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Access for ${name}`}
        title={disabled ? disabledReason : on ? "Access on: click to turn off" : "Access off: click to turn on"}
        disabled={disabled || pending}
        onClick={flip}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          on ? "bg-brand" : "bg-zinc-300",
        )}
      >
        <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
      </button>
      <span className={cn("text-[10px] font-black tracking-[0.05em] uppercase", on ? "text-brand" : "text-zinc-500")}>
        {pending ? "Saving…" : on ? "Full access" : "No access"}
      </span>
      {error ? (
        <p role="alert" className="max-w-[220px] text-right text-[11px] font-semibold text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
