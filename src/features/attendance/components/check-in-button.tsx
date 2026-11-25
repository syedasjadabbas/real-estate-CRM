"use client";

import { Check, Timer } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkInAction, checkOutAction } from "../actions";

export type TodayAttendance = { checkIn: string | null; checkOut: string | null };

/** Check in, then Check out, beside Log out (client, 25 Nov 2026). */
export function CheckInButton({ today }: { today: TodayAttendance }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (today.checkOut) {
    return (
      <span title={`In ${today.checkIn} · Out ${today.checkOut}`} className="inline-flex items-center gap-1 rounded-xl bg-zinc-100 px-2.5 py-2 text-[11px] font-bold text-zinc-600">
        <Check aria-hidden="true" className="size-3.5" />
        <span className="hidden sm:inline">Done for today</span>
      </span>
    );
  }
  const label = today.checkIn ? "Check out" : "Check in";
  return (
    <Button
      variant={today.checkIn ? "secondary" : "primary"}
      disabled={pending}
      aria-label={label}
      title={error ?? (today.checkIn ? `Checked in at ${today.checkIn}` : "Start your day")}
      className="px-2.5 sm:px-3"
      onClick={() =>
        startTransition(async () => {
          const r = await (today.checkIn ? checkOutAction() : checkInAction());
          setError(r.ok ? null : r.message);
        })
      }
    >
      <Timer aria-hidden="true" className="size-4" />
      <span className="hidden sm:inline">{pending ? "Saving…" : error ? "Try again" : label}</span>
    </Button>
  );
}
