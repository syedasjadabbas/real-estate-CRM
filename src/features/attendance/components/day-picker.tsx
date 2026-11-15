"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Picks the day for the attendance sheet; the sheet changes as soon as a date is chosen (no Show button). */
export function DayPicker({ path, value, max }: { path: string; value: string; max: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <input
      type="date"
      aria-label="Choose a day"
      value={value}
      max={max}
      disabled={pending}
      onChange={(e) => {
        const date = e.target.value;
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= max) startTransition(() => router.push(`${path}?date=${date}`));
      }}
      className="h-9 rounded-lg border border-zinc-200/80 bg-white px-2 text-xs font-semibold disabled:opacity-60"
    />
  );
}
