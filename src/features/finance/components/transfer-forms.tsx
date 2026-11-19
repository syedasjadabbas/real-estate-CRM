"use client";

import { Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { StatusTag } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { PendingTransferRow } from "@/modules/finance/transfers";
import { recordTransferAction } from "../actions";

const fmt = (n: number) => `PKR ${new Intl.NumberFormat("en-US").format(n)}`;
const days = (n: number) => `${n} working day${n === 1 ? "" : "s"}`;
const daysNote = (left: number) => (left === 0 ? "due today" : left < 0 ? `${days(-left)} late` : `${days(left)} left`);
const STATUS = {
  overdue: { label: "Overdue", tone: "rose" },
  due_soon: { label: "Due soon", tone: "amber" },
  pending: { label: "Pending", tone: "neutral" },
} as const;

/** Receipts held for the developer: tick the ones a bank transfer covered and record it. */
export function PendingTransfers({ rows, today, canRecord }: { rows: PendingTransferRow[]; today: string; canRecord: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | keyof typeof STATUS>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [values, setValues] = useState({ transferredOn: today, reference: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => (status === "all" || r.status === status) && (!needle || [r.receipt, r.leadName, r.unitNo, r.projectName].some((v) => v.toLowerCase().includes(needle))));
  }, [rows, q, status]);
  const pickedRows = rows.filter((r) => picked.has(r.id));
  const pickedTotal = pickedRows.reduce((n, r) => n + Math.round(r.amount * 100), 0) / 100;
  const allShown = filtered.length > 0 && filtered.every((r) => picked.has(r.id));
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">Search receipts</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search receipt, buyer, unit or project" className="pl-8" />
        </label>
        <div role="group" aria-label="Status" className="flex rounded-xl border border-zinc-200/80 bg-white p-0.5 text-xs font-semibold">
          {(["all", "overdue", "due_soon", "pending"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)} className={cn("rounded-lg px-3 py-1.5", status === k ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100")}>
              {k === "all" ? "All" : STATUS[k].label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState size="sm">{rows.length === 0 ? "Every receipt has been passed to the developer." : "Nothing matches this search."}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
          <table className="w-full min-w-max border-collapse text-left text-xs">
            <thead className="bg-zinc-100">
              <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                {canRecord ? (
                  <th scope="col" className="w-8 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Tick every receipt shown"
                      checked={allShown}
                      onChange={() =>
                        setPicked((s) => {
                          const n = new Set(s);
                          for (const r of filtered) {
                            if (allShown) n.delete(r.id);
                            else n.add(r.id);
                          }
                          return n;
                        })
                      }
                    />
                  </th>
                ) : null}
                <th scope="col" className="px-3 py-3">Receipt</th>
                <th scope="col" className="px-3 py-3">Buyer · unit</th>
                <th scope="col" className="px-3 py-3">Received</th>
                <th scope="col" className="px-3 py-3">Transfer by</th>
                <th scope="col" className="px-3 py-3 text-right">Amount</th>
                <th scope="col" className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={cn("border-b border-zinc-100/80 last:border-b-0", picked.has(r.id) && "bg-brand-50/50")}>
                  {canRecord ? (
                    <td className="px-3 py-2.5">
                      <input type="checkbox" aria-label={`Include receipt ${r.receipt}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                  ) : null}
                  <td className="px-3 py-2.5 font-semibold">
                    <a href={`/dashboard/finance/payments/${r.id}`} className="hover:underline">
                      {r.receipt}
                    </a>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.leadName} · {r.projectName} {r.unitNo}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{r.receivedOn}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {r.dueOn}
                    <span className="ml-1 text-zinc-500">({daysNote(r.workingDaysLeft)})</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.amount)}</td>
                  <td className="px-3 py-2.5">
                    <StatusTag tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusTag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canRecord ? (
        <div className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-hairline sm:grid-cols-3">
          <p className="text-sm font-black text-zinc-900 sm:col-span-3">
            Record a transfer · {picked.size} receipt{picked.size === 1 ? "" : "s"} ticked · {fmt(pickedTotal)}
          </p>
          <Field label="Transferred on" required error={errors.transferredOn}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" max={today} value={values.transferredOn} disabled={pending} onChange={(e) => setValues((v) => ({ ...v, transferredOn: e.target.value }))} />}
          </Field>
          <Field label="Bank reference" error={errors.reference}>
            {(id, d) => <Input id={id} aria-describedby={d} value={values.reference} disabled={pending} onChange={(e) => setValues((v) => ({ ...v, reference: e.target.value }))} />}
          </Field>
          <Field label="Note" error={errors.note}>
            {(id, d) => <Input id={id} aria-describedby={d} value={values.note} disabled={pending} onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))} />}
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
            <Button
              size="lg"
              disabled={pending || picked.size === 0}
              onClick={() =>
                startTransition(async () => {
                  const result = await recordTransferAction({ ...values, paymentIds: [...picked] });
                  if (result.ok) {
                    setPicked(new Set());
                    setErrors({});
                    setValues({ transferredOn: today, reference: "", note: "" });
                    setMsg({ text: `Transfer of ${fmt(result.data.amount)} recorded for ${result.data.receipts} receipt${result.data.receipts === 1 ? "" : "s"}.`, ok: true });
                  } else {
                    setErrors(result.fields ?? {});
                    setMsg({ text: result.message, ok: false });
                  }
                })
              }
            >
              {pending ? "Saving…" : "Record transfer"}
            </Button>
            {msg ? (
              <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
                {msg.text}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
