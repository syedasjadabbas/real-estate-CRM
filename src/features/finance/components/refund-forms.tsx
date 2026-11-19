"use client";

import { Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { StatusTag } from "@/components/ui/badge";
import { selectClass } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import type { RefundDueRow } from "@/modules/finance/refunds";
import { recordRefundAction } from "../actions";

const fmt = (n: number) => `PKR ${new Intl.NumberFormat("en-US").format(n)}`;

function RefundForm({ row, methods, today, onDone }: { row: RefundDueRow; methods: { id: string; name: string }[]; today: string; onDone: (text: string) => void }) {
  const [values, setValues] = useState({ amount: String(row.remaining), paidOn: today, methodId: "", reference: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3 sm:grid-cols-2 lg:grid-cols-5">
      <Field label="Amount (PKR)" required error={errors.amount}>
        {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" value={values.amount} disabled={pending} onChange={(e) => set({ amount: e.target.value })} />}
      </Field>
      <Field label="Paid on" required error={errors.paidOn}>
        {(id, d) => <Input id={id} aria-describedby={d} type="date" max={today} value={values.paidOn} disabled={pending} onChange={(e) => set({ paidOn: e.target.value })} />}
      </Field>
      <Field label="Method" required error={errors.methodId}>
        {(id, d) => (
          <select id={id} aria-describedby={d} value={values.methodId} onChange={(e) => set({ methodId: e.target.value })} className={selectClass} disabled={pending}>
            <option value="">Select…</option>
            {methods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Bank / cheque ref" error={errors.reference}>
        {(id, d) => <Input id={id} aria-describedby={d} value={values.reference} disabled={pending} onChange={(e) => set({ reference: e.target.value })} />}
      </Field>
      <Field label="Note" error={errors.note}>
        {(id, d) => <Input id={id} aria-describedby={d} value={values.note} disabled={pending} onChange={(e) => set({ note: e.target.value })} />}
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-5">
        <Button
          size="lg"
          disabled={pending || !values.amount.trim() || !values.methodId}
          onClick={() =>
            startTransition(async () => {
              const result = await recordRefundAction(row.bookingId, { ...values, amount: values.amount.replace(/,/g, "") });
              if (result.ok) {
                setErrors({});
                setMsg(null);
                onDone(`Refund ${result.data.ref} recorded for ${row.leadName}.${result.data.remaining > 0 ? ` ${fmt(result.data.remaining)} still due.` : " Paid in full."}`);
              } else {
                setErrors(result.fields ?? {});
                setMsg(result.message);
              }
            })
          }
        >
          {pending ? "Saving…" : "Record refund"}
        </Button>
        {msg ? (
          <p role="alert" className="text-xs font-semibold text-rose-600">
            {msg}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Refunds owed on cancelled bookings; Accounts records each payment back to the buyer. */
export function RefundsList({ rows, methods, today, canRecord }: { rows: RefundDueRow[]; methods: { id: string; name: string }[]; today: string; canRecord: boolean }) {
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"open" | "settled" | "all">("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (show === "open" && r.remaining <= 0) return false;
      if (show === "settled" && r.remaining > 0) return false;
      if (!needle) return true;
      return [r.ref, r.leadName, r.unitNo, r.projectName, r.cancelledReason ?? ""].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [rows, q, show]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">Search refunds</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search booking, buyer, unit or project" className="pl-8" />
        </label>
        <div role="group" aria-label="Show" className="flex rounded-xl border border-zinc-200/80 bg-white p-0.5 text-xs font-semibold">
          {(["open", "settled", "all"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={cn("rounded-lg px-3 py-1.5", show === k ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100")}>
              {k === "open" ? "Still due" : k === "settled" ? "Paid in full" : "All"}
            </button>
          ))}
        </div>
      </div>
      {done ? (
        <p role="status" className="text-xs font-semibold text-brand">
          {done}
        </p>
      ) : null}
      {filtered.length === 0 ? (
        <EmptyState size="sm">{rows.length === 0 ? "No cancelled bookings with a refund due." : "Nothing matches this search."}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => (
            <li key={r.bookingId} className="rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-hairline">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-zinc-900">
                    <a href={`/dashboard/bookings/${r.bookingId}`} className="hover:underline">
                      {r.ref}
                    </a>{" "}
                    · {r.leadName}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {r.projectName} · Unit {r.unitNo}
                    {r.cancelledAt ? ` · cancelled ${new Date(r.cancelledAt).toLocaleDateString("en-GB", { timeZone: "Asia/Karachi" })}` : ""}
                    {r.cancelledReason ? ` · ${r.cancelledReason}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-right text-xs tabular-nums">
                  <span>
                    <span className="block text-[10px] font-black text-zinc-500 uppercase">Deduction</span>
                    {fmt(r.deduction)}
                  </span>
                  <span>
                    <span className="block text-[10px] font-black text-zinc-500 uppercase">Refund due</span>
                    {fmt(r.due)}
                  </span>
                  <span>
                    <span className="block text-[10px] font-black text-zinc-500 uppercase">Refunded</span>
                    {fmt(r.refunded)}
                  </span>
                  <span>
                    <span className="block text-[10px] font-black text-zinc-500 uppercase">Left</span>
                    <b>{fmt(r.remaining)}</b>
                  </span>
                  {r.remaining > 0 ? (
                    canRecord ? (
                      <Button variant="secondary" size="sm" aria-expanded={openId === r.bookingId} onClick={() => setOpenId(openId === r.bookingId ? null : r.bookingId)}>
                        {openId === r.bookingId ? "Close" : "Record refund"}
                      </Button>
                    ) : (
                      <StatusTag tone="amber">Due</StatusTag>
                    )
                  ) : (
                    <StatusTag tone="brand">Paid in full</StatusTag>
                  )}
                </div>
              </div>
              {canRecord && openId === r.bookingId && r.remaining > 0 ? (
                <RefundForm
                  row={r}
                  methods={methods}
                  today={today}
                  onDone={(text) => {
                    setOpenId(null);
                    setDone(text);
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
