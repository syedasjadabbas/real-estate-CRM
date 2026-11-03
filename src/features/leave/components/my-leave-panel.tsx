"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { formatListedOn } from "@/features/inventory/format";
import { selectClass } from "@/features/leads/components/lead-fields";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { cn } from "@/lib/cn";
import { calendarDays, CROSS_YEAR_HELD_NOTE, isCrossYear, LEAVE_TYPE_LABELS, LEAVE_TYPES, type LeaveStatus, type LeaveType } from "@/modules/leave/rules";
import { LeaveStatusTag } from "./leave-status";
import { requestLeaveCancellationAction, submitLeaveAction, withdrawLeaveAction } from "../actions";

type Row = { id: string; type: LeaveType; startDate: string; endDate: string; days: number; reason: string | null; status: LeaveStatus };
type Balance = { year: number; allowance: number; prorated: boolean; provisional: boolean; granted: number; pending: number; remaining: number };

/**
 * My leave (FR-130, questionnaire Q4–Q17): balance for the year, a request form (calendar days,
 * past dates allowed, refused above the remaining balance) and the person's requests.
 */
export function MyLeavePanel({ balance, rows, today, years = [] }: { balance: Balance; rows: Row[]; today: string; years?: { year: number; current: boolean; href: string }[] }) {
  const [v, setV] = useState({ type: "annual" as LeaveType, startDate: today, endDate: today, reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [pending, startTransition] = useTransition();
  const days = v.startDate && v.endDate && v.startDate <= v.endDate ? calendarDays(v.startDate, v.endDate) : 0;
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, ok: string) =>
    startTransition(async () => {
      const r = await fn();
      setMsg(r.ok ? { text: ok, ok: true } : { text: r.message ?? "Something went wrong.", ok: false });
      if (r.ok) setCancelFor(null);
    });

  return (
    <PanelCard title={`My leave · ${balance.year}`}>
      {years.length > 1 ? (
        <nav aria-label="Leave year" className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">Year</span>
          {years.map((y) => (
            <Link
              key={y.year}
              href={y.href}
              aria-current={y.current ? "page" : undefined}
              className={cn("rounded-lg border px-2.5 py-1 font-bold", y.current ? "border-brand/40 bg-brand-50 text-brand-700" : "border-zinc-200/80 text-zinc-700 hover:bg-zinc-50")}
            >
              {y.year}
            </Link>
          ))}
        </nav>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Allowance", `${balance.allowance}`, balance.provisional ? "Prorated from joining date (provisional method)" : balance.prorated ? "Prorated from joining date" : `${balance.year}`],
          ["Taken", `${balance.granted}`, "Approved days"],
          ["Pending", `${balance.pending}`, "Awaiting approval"],
          ["Remaining", `${balance.remaining}`, `Days left in ${balance.year}`],
        ].map(([label, value, caption]) => (
          <div key={label} className="rounded-xl border border-zinc-200/80 px-3 py-2">
            <dt className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{label}</dt>
            <dd className="text-lg font-black tabular-nums" data-leave-stat={label}>
              {value}
            </dd>
            <p className="text-[11px] text-zinc-500">{caption}</p>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-zinc-500">Leave is counted in calendar days, weekends and holidays included. Medical (CPL) leave comes out of the annual allowance. Unused days don&apos;t carry over.</p>

      <form
        noValidate
        aria-label="Request leave"
        className="mt-4 space-y-3 border-t border-zinc-100 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await submitLeaveAction(v);
            if (r.ok) {
              setErrors({});
              setMsg({ text: r.data.held ? `Leave requested: ${r.data.days} days, held (two calendar years).` : `Leave requested: ${r.data.days} day${r.data.days === 1 ? "" : "s"}.`, ok: true });
              setV((s) => ({ ...s, reason: "" }));
            } else {
              setErrors(r.fields ?? {});
              setMsg({ text: r.fields?.endDate ?? r.fields?.startDate ?? r.message, ok: false });
            }
          });
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Leave type" error={errors.type}>
            {(id, d) => (
              <select id={id} aria-describedby={d} className={selectClass} value={v.type} disabled={pending} onChange={(e) => setV((s) => ({ ...s, type: e.target.value as LeaveType }))}>
                {LEAVE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LEAVE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="First day" error={errors.startDate}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" invalid={Boolean(errors.startDate)} value={v.startDate} disabled={pending} onChange={(e) => setV((s) => ({ ...s, startDate: e.target.value }))} />}
          </Field>
          <Field label="Last day" error={errors.endDate} hint={days ? `${days} calendar day${days === 1 ? "" : "s"}` : undefined}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" invalid={Boolean(errors.endDate)} value={v.endDate} disabled={pending} onChange={(e) => setV((s) => ({ ...s, endDate: e.target.value }))} />}
          </Field>
        </div>
        <Field label="Reason" error={errors.reason}>
          {(id, d) => <Input id={id} aria-describedby={d} maxLength={500} value={v.reason} disabled={pending} onChange={(e) => setV((s) => ({ ...s, reason: e.target.value }))} />}
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {msg ? (
            <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
              {msg.text}
            </p>
          ) : null}
          <Button type="submit" variant="primary" size="lg" disabled={pending}>
            {pending ? "Sending…" : "Request leave"}
          </Button>
        </div>
      </form>

      <div className="mt-4 border-t border-zinc-100 pt-4">
        {rows.length === 0 ? (
          <EmptyState size="sm">No leave requested in {balance.year}.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100" aria-label="My leave requests">
            {rows.map((r) => (
              <li key={r.id} className="py-2.5 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-zinc-900">
                    {LEAVE_TYPE_LABELS[r.type]} · {formatListedOn(r.startDate)}
                    {r.endDate !== r.startDate ? ` – ${formatListedOn(r.endDate)}` : ""} · {r.days} day{r.days === 1 ? "" : "s"}
                  </p>
                  <span className="flex items-center gap-2">
                    <LeaveStatusTag status={r.status} />
                    {r.status === "pending" ? (
                      <button type="button" className="text-[11px] font-bold text-brand hover:underline" disabled={pending} onClick={() => act(() => withdrawLeaveAction(r.id), "Request withdrawn.")}>
                        Withdraw
                      </button>
                    ) : null}
                    {r.status === "approved" ? (
                      <button type="button" className="text-[11px] font-bold text-brand hover:underline" disabled={pending} onClick={() => setCancelFor(cancelFor === r.id ? null : r.id)}>
                        Request cancellation
                      </button>
                    ) : null}
                  </span>
                </div>
                {r.reason ? <p className="text-[11px] text-zinc-500">{r.reason}</p> : null}
                {r.status === "pending" && isCrossYear(r) ? <p className="text-[11px] font-semibold text-amber-800">{CROSS_YEAR_HELD_NOTE}</p> : null}
                {cancelFor === r.id ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Field label="Why cancel?" className="min-w-[220px] flex-1">
                      {(id) => <Input id={id} value={cancelReason} maxLength={500} disabled={pending} onChange={(e) => setCancelReason(e.target.value)} />}
                    </Field>
                    <Button variant="secondary" size="lg" disabled={pending || !cancelReason.trim()} onClick={() => act(() => requestLeaveCancellationAction(r.id, { reason: cancelReason }), "Cancellation requested. An Admin or Super Admin will decide.")}>
                      Send
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </PanelCard>
  );
}
