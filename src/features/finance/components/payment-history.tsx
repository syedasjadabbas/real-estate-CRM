import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatListedOn, formatPrice } from "@/features/inventory/format";
import { cn } from "@/lib/cn";
import { PAYMENT_TYPE_LABELS } from "@/modules/finance/constants";
import type { PaymentHistoryRow } from "@/modules/finance/queries";

/** Itemised payments and reversals (FR-204) for booking and client pages. */
export function PaymentHistoryList({ rows, empty, showBooking = false }: { rows: (PaymentHistoryRow & { bookingLabel?: string })[]; empty: string; showBooking?: boolean }) {
  if (rows.length === 0) return <EmptyState size="sm">{empty}</EmptyState>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const reversal = r.kind === "reversal";
        return (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
            <div className="min-w-0">
              <Link href={`/dashboard/finance/payments/${r.id}`} className="font-bold hover:text-brand hover:underline">
                {reversal ? `Reversal ${r.displayRef}` : `Receipt ${r.displayRef}`}
              </Link>{" "}
              <span className="text-zinc-500">
                · {PAYMENT_TYPE_LABELS[r.type]} · {formatListedOn(r.receivedOn)}
                {r.methodName ? ` · ${r.methodName}` : ""}
                {reversal && r.originalReceipt ? ` · of receipt ${r.originalReceipt}` : ""}
                {showBooking && r.bookingLabel ? ` · ${r.bookingLabel}` : ""}
              </span>
              {r.pendingRequest ? <p className="text-[11px] font-semibold text-amber-700">Reversal requested, waiting for approval</p> : null}
            </div>
            <span className={cn("font-black tabular-nums", reversal ? "text-rose-700" : r.reversed ? "text-zinc-400 line-through" : "text-zinc-900")}>
              {reversal ? "−" : ""}
              {formatPrice(r.amount)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
