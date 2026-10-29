import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatListedOn, formatPrice } from "@/features/inventory/format";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { PAYMENT_TYPE_LABELS } from "@/modules/finance/constants";
import type { PaymentListRow } from "@/modules/finance/queries";

const COLUMNS = ["Receipt / ref", "Received on", "Lead", "Unit", "Project", "Type", "Method", "Amount", "Status", "Recorded", ""];

/** Payments and reversals in the Leads table style. Reversals show negative amounts and the receipt they reverse. */
export function PaymentsTable({ rows, emptyMessage }: { rows: PaymentListRow[]; emptyMessage: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-hairline">
      <div className="relative max-h-[540px] overflow-auto">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-100">
            <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
              {COLUMNS.map((c, i) => (
                <th key={i} scope="col" className="px-3 py-4 whitespace-nowrap">
                  {c || <span className="sr-only">Open</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const reversal = r.kind === "reversal";
              return (
                <tr key={r.id} className="border-b border-zinc-100/80 bg-white align-top last:border-b-0 hover:bg-zinc-50/60">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="font-bold tracking-[0.02em] text-zinc-900">{reversal ? `Reversal ${r.displayRef}` : `Receipt ${r.displayRef}`}</span>
                    {reversal && r.originalReceipt ? <span className="block text-[11px] text-zinc-500">of receipt {r.originalReceipt}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{formatListedOn(r.receivedOn)}</td>
                  <td className="max-w-[200px] px-3 py-2.5 font-bold">{r.leadName}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.unitNo}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.projectName}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{PAYMENT_TYPE_LABELS[r.type]}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.methodName ?? "—"}</td>
                  <td className={cn("px-3 py-2.5 whitespace-nowrap font-semibold tabular-nums", reversal ? "text-rose-700" : "text-zinc-900")}>
                    {reversal ? "−" : ""}
                    {formatPrice(r.amount)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] leading-[13px] font-black tracking-[0.025em] uppercase",
                        reversal ? "bg-rose-50 text-rose-700" : r.reversed ? "bg-zinc-100 text-zinc-500" : "bg-brand-50 text-brand-700",
                      )}
                    >
                      {reversal ? "Reversal" : r.reversed ? "Reversed" : "Posted"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-600">
                    {formatDateTime(r.recordedAt)}
                    <span className="block text-[11px] text-zinc-500">{r.recordedByName ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/dashboard/finance/payments/${r.id}`} className="text-xs font-bold text-brand hover:underline" aria-label={`Open ${reversal ? "reversal" : "receipt"} ${r.displayRef}`}>
                      Open →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState>{emptyMessage}</EmptyState>
          </div>
        ) : null}
      </div>
    </div>
  );
}
