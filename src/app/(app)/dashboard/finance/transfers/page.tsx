import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { StatusTag } from "@/components/ui/badge";
import { MiniStat } from "@/components/ui/stat";
import { PendingTransfers } from "@/features/finance/components/transfer-forms";
import { formatPrice } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { businessToday } from "@/modules/bookings/today";
import { canDoFinance } from "@/modules/finance/policy";
import { pendingTransfers, TRANSFER_WORKING_DAYS, transferHistory } from "@/modules/finance/transfers";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Finance · Developer transfers" };

/** 10-working-day tracker: receipts held for the developer, and the transfers made. */
export default async function TransfersPage() {
  const actor = await requirePageUser();
  if (!canDoFinance(actor, "viewAll")) return <RestrictedState />;
  const db = getDb();
  const today = businessToday();
  const [pending, history] = await Promise.all([pendingTransfers(db, actor, today), transferHistory(db, actor)]);
  const t = pending.totals;
  return (
    <section className="space-y-6" aria-label="Developer transfers">
      <PageHeader
        as="h2"
        title="Developer transfers"
        description={`Every receipt is passed to the developer within ${TRANSFER_WORKING_DAYS} working days of being received. Working days skip the weekly day off and company holidays (HR settings). Tick the receipts a bank transfer covered and record it.`}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniStat label="Held for the developer" value={formatPrice(t.amount)} caption={`${t.count} receipt${t.count === 1 ? "" : "s"}`} />
        <MiniStat label="Overdue" value={formatPrice(t.overdueAmount)} caption={`${t.overdue} receipt${t.overdue === 1 ? "" : "s"} past the deadline`} />
        <MiniStat label="Due soon" value={String(t.dueSoon)} caption="2 working days or fewer left" />
      </div>
      <PendingTransfers rows={pending.rows} today={today} canRecord={canDoFinance(actor, "record")} />
      <PanelCard title="Transfers made">
        {history.length === 0 ? (
          <EmptyState size="sm">No transfers recorded yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <thead className="bg-zinc-100">
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className="px-3 py-3">Date</th>
                  <th scope="col" className="px-3 py-3">Bank reference</th>
                  <th scope="col" className="px-3 py-3 text-right">Receipts</th>
                  <th scope="col" className="px-3 py-3 text-right">Amount</th>
                  <th scope="col" className="px-3 py-3">On time</th>
                  <th scope="col" className="px-3 py-3">Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-zinc-100/80 last:border-b-0">
                    <td className="px-3 py-2.5 font-semibold tabular-nums">{h.transferredOn}</td>
                    <td className="px-3 py-2.5">
                      {h.reference ?? "—"}
                      {h.note ? <span className="block text-zinc-500">{h.note}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{h.receipts}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatPrice(h.amount)}</td>
                    <td className="px-3 py-2.5">{h.onTime ? <StatusTag tone="brand">On time</StatusTag> : <StatusTag tone="rose">{`Late (${h.late} of ${h.receipts})`}</StatusTag>}</td>
                    <td className="px-3 py-2.5">{h.recordedBy ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>
    </section>
  );
}
