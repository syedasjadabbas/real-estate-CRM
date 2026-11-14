"use client";

import { useState } from "react";
import type { PaymentPlan } from "@/modules/projects/payment-plan";
import { formatPrice } from "@/features/inventory/format";

type Row = { no: number; label: string; due: string; amount: number };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const showDate = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const round = (n: number) => Math.round(n);

/** The 10th of the month `months` after the booking's month (installments fall due on the 10th). */
function tenthAfter(start: string, months: number) {
  const d = new Date(`${start}T00:00:00`);
  return ymd(new Date(d.getFullYear(), d.getMonth() + months, 10));
}

function Num({ label, value, onChange, suffix, min = 0, max = 100, step = 1 }: { label: string; value: number; onChange: (n: number) => void; suffix?: string; min?: number; max?: number; step?: number }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-bold text-zinc-600">
      {label}
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))}
          className="h-9 w-24 rounded-lg border border-zinc-200 bg-white px-2 text-sm font-semibold text-zinc-900 focus:border-brand/50 focus:outline-none"
        />
        {suffix ? <span className="text-xs text-zinc-500">{suffix}</span> : null}
      </span>
    </label>
  );
}

/**
 * Payment plan on the booking form (owner, 14 Nov 2026): down payment (the token counts towards it),
 * installments, optional balloon payments and a possession amount, all from the booking's total.
 * The settings box doesn't print; the summary and the dated schedule do. Rounding goes to the last
 * installment so the schedule always adds up to the total.
 */
export function BookingPlan({
  total,
  token,
  bookedOn,
  plan,
}: {
  total: number;
  token: number;
  bookedOn: string;
  /** The project's payment plan (owner, 14 Nov 2026); the settings box starts from it. */
  plan: PaymentPlan;
}) {
  const [downPct, setDownPct] = useState(plan.downPaymentPct);
  const [count, setCount] = useState(plan.installmentCount);
  const [everyMonths, setEveryMonths] = useState(plan.everyMonths);
  const [balloonOn, setBalloonOn] = useState(plan.balloonCount > 0);
  const [balloonCount, setBalloonCount] = useState(plan.balloonCount || 4);
  const [balloonPct, setBalloonPct] = useState(plan.balloonPct || 5);
  const [possessionPct, setPossessionPct] = useState(plan.possessionPct);

  const down = round(total * (downPct / 100));
  const downBalance = Math.max(0, down - token);
  const balloons = balloonOn ? balloonCount : 0;
  const balloonEach = balloonOn ? round(total * (balloonPct / 100)) : 0;
  const possession = round(total * (possessionPct / 100));
  const remaining = total - down - balloonEach * balloons - possession;
  const n = Math.max(1, count);
  const each = Math.floor(remaining / n);
  const invalid = remaining < 0;

  const rows: Row[] = [];
  if (!invalid) {
    let no = 1;
    rows.push({ no: no++, label: "Token (paid at booking)", due: bookedOn, amount: Math.min(token, down) });
    const dueDown = new Date(`${bookedOn}T00:00:00`);
    dueDown.setDate(dueDown.getDate() + 7);
    if (downBalance > 0) rows.push({ no: no++, label: `Down payment balance (${downPct}% less token)`, due: ymd(dueDown), amount: downBalance });
    // Balloons fall evenly through the installment period.
    const spanMonths = n * everyMonths;
    const balloonMonths = new Set(Array.from({ length: balloons }, (_, i) => Math.round(((i + 1) * spanMonths) / (balloons + 1))));
    let paidInstallments = 0;
    for (let i = 1; i <= n; i++) {
      const month = i * everyMonths;
      const last = i === n;
      const amount = last ? remaining - each * (n - 1) : each;
      rows.push({ no: no++, label: `Installment ${i} of ${n}`, due: tenthAfter(bookedOn, month), amount });
      paidInstallments += amount;
      for (const m of balloonMonths) {
        if (m > month - everyMonths && m <= month) rows.push({ no: no++, label: `Balloon payment`, due: tenthAfter(bookedOn, m), amount: balloonEach });
      }
    }
    void paidInstallments;
    rows.push({ no: no++, label: "On possession", due: tenthAfter(bookedOn, n * everyMonths + 1), amount: possession });
  }
  const sum = rows.reduce((a, r) => a + r.amount, 0) + (token > down ? token - down : 0);

  return (
    <>
      <div className="relative space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 print:hidden">
        <p className="text-[11px] font-black tracking-[0.15em] text-amber-900 uppercase">Plan settings (not printed)</p>
        <div className="flex flex-wrap gap-4">
          <Num label="Down payment" value={downPct} onChange={setDownPct} suffix="%" />
          <Num label="Installments" value={count} onChange={setCount} min={1} max={240} />
          <label className="flex flex-col gap-1 text-[11px] font-bold text-zinc-600">
            Every
            <select value={everyMonths} onChange={(e) => setEveryMonths(Number(e.target.value))} className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm font-semibold text-zinc-900">
              <option value={1}>Month</option>
              <option value={3}>3 months (quarterly)</option>
              <option value={6}>6 months</option>
            </select>
          </label>
          <Num label="Possession amount" value={possessionPct} onChange={setPossessionPct} suffix="%" />
        </div>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="size-4 accent-[#107c41]" checked={balloonOn} onChange={(e) => setBalloonOn(e.target.checked)} />
          Balloon payments
        </label>
        {balloonOn ? (
          <div className="flex flex-wrap gap-4">
            <Num label="How many" value={balloonCount} onChange={setBalloonCount} min={1} max={20} />
            <Num label="Each" value={balloonPct} onChange={setBalloonPct} suffix="% of total" step={0.5} />
          </div>
        ) : null}
        {invalid ? <p className="text-xs font-bold text-rose-600">These percentages add up to more than the total price. Lower the down payment, balloons or possession.</p> : null}
      </div>

      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {[
          ["Total price", formatPrice(total)],
          [`Down payment (${downPct}%)`, formatPrice(down)],
          ["  of which token paid", formatPrice(Math.min(token, down))],
          ["  down payment balance", formatPrice(downBalance)],
          [`${n} installments (${everyMonths === 1 ? "monthly" : `every ${everyMonths} months`}) of`, invalid ? "—" : formatPrice(each)],
          ...(balloons ? [[`${balloons} balloon payments of`, formatPrice(balloonEach)]] : []),
          [`On possession (${possessionPct}%)`, formatPrice(possession)],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-zinc-200 py-1.5 text-sm">
            <span className="whitespace-pre text-zinc-600">{label}</span>
            <span className="text-right font-bold tabular-nums">{value}</span>
          </div>
        ))}
      </div>

      {!invalid ? (
        <div className="relative pt-3">
          <p className="mb-2 text-[11px] font-black tracking-[0.2em] text-[#107c41] uppercase">Payment schedule</p>
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b-2 border-zinc-300 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                <th className="py-1.5 pr-2">#</th>
                <th className="py-1.5 pr-2">Payment</th>
                <th className="py-1.5 pr-2">Due date</th>
                <th className="py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no} className="break-inside-avoid border-b border-zinc-100">
                  <td className="py-1 pr-2 tabular-nums">{r.no}</td>
                  <td className={`py-1 pr-2 ${r.label === "Balloon payment" || r.label === "On possession" ? "font-bold" : ""}`}>{r.label}</td>
                  <td className="py-1 pr-2 whitespace-nowrap tabular-nums">{showDate(r.due)}</td>
                  <td className="py-1 text-right tabular-nums">{formatPrice(r.amount)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-zinc-300 font-black">
                <td colSpan={3} className="py-1.5">
                  Total
                </td>
                <td className="py-1.5 text-right tabular-nums">{formatPrice(sum)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
