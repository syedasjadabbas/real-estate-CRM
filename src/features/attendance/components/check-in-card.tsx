"use client";

import { LogIn, LogOut } from "lucide-react";
import { useState, useTransition } from "react";
import { StatusTag, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { cn } from "@/lib/cn";
import { ATTENDANCE_STATUS_LABELS, formatMinutes, type AttendanceStatus } from "@/modules/attendance/rules";
import { checkInAction, checkOutAction } from "../actions";

export const STATUS_TONES: Record<AttendanceStatus, Tone> = {
  present: "brand",
  late: "amber",
  absent: "rose",
  on_leave: "sky",
  holiday: "neutral",
  weekend: "neutral",
  not_yet: "neutral",
  upcoming: "neutral",
};

type Month = { present: number; late: number; absent: number; onLeave: number; workingDays: number; minutes: number };

/** My workplace: check in and out for today, with this month's tally (owner, 15 Nov 2026). */
export function CheckInCard({
  status,
  checkIn,
  checkOut,
  minutes,
  officeStart,
  lateAfter,
  officeEnd,
  month,
}: {
  status: AttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  minutes: number | null;
  officeStart: string;
  lateAfter: string;
  officeEnd: string;
  month: Month;
}) {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const act = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) =>
    startTransition(async () => {
      const r = await fn();
      setMsg(r.ok ? { text: done, ok: true } : { text: r.message, ok: false });
    });

  return (
    <PanelCard title="Attendance today">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <StatusTag tone={STATUS_TONES[status]}>{ATTENDANCE_STATUS_LABELS[status]}</StatusTag>
            <p className="text-xs text-zinc-600 tabular-nums">
              In <span className="font-bold text-zinc-900">{checkIn ?? "—"}</span> · Out <span className="font-bold text-zinc-900">{checkOut ?? "—"}</span>
              {minutes !== null ? <> · {formatMinutes(minutes)}</> : null}
            </p>
          </div>
          {!checkIn ? (
            <Button variant="primary" size="lg" disabled={pending} onClick={() => act(checkInAction, "Checked in.")}>
              <LogIn aria-hidden="true" className="size-4" />
              {pending ? "Saving…" : "Check in"}
            </Button>
          ) : !checkOut ? (
            <Button variant="secondary" size="lg" disabled={pending} onClick={() => act(checkOutAction, "Checked out.")}>
              <LogOut aria-hidden="true" className="size-4" />
              {pending ? "Saving…" : "Check out"}
            </Button>
          ) : (
            <p className="text-xs font-semibold text-zinc-500">Done for today</p>
          )}
        </div>
        <p className="text-[11px] text-zinc-500">
          Office hours {officeStart}–{officeEnd}. A check-in after {lateAfter} is late. Forgot to check in or out? Ask HR to correct the day.
        </p>
        <dl className="grid grid-cols-4 gap-2 border-t border-zinc-100 pt-3 text-center">
          {[
            ["Present", month.present + month.late],
            ["Late", month.late],
            ["Absent", month.absent],
            ["Leave", month.onLeave],
          ].map(([label, n]) => (
            <div key={label} className="rounded-xl bg-zinc-50 py-2">
              <dt className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{label}</dt>
              <dd className="text-base font-black tabular-nums">{n}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] text-zinc-500">
          This month: {month.workingDays} working day{month.workingDays === 1 ? "" : "s"} so far · {formatMinutes(month.minutes)} worked
        </p>
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </PanelCard>
  );
}
