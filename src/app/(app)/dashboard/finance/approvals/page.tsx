import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { DecideReversalForm } from "@/features/finance/components/reversal-forms";
import { formatPrice } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { canDoFinance } from "@/modules/finance/policy";
import { getFinanceSettings, reversalRequestsForActor, receiptLabel } from "@/modules/finance/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Finance · Reversal approvals" };

export default async function ReversalApprovalsPage() {
  const actor = await requirePageUser();
  if (!canDoFinance(actor, "viewAll") && !canDoFinance(actor, "decideReversal")) return <RestrictedState />;
  const db = getDb();
  const [pending, approved, rejected, settings] = await Promise.all([
    reversalRequestsForActor(db, actor, "pending"),
    reversalRequestsForActor(db, actor, "approved"),
    reversalRequestsForActor(db, actor, "rejected"),
    getFinanceSettings(db),
  ]);
  const canDecide = canDoFinance(actor, "decideReversal");
  const receipt = (n: number | null, floor: string | null) => receiptLabel(settings.receipt_prefix, floor, n);
  const decided = [...approved, ...rejected].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 25);

  return (
    <section className="space-y-6" aria-label="Reversal approvals">
      <PageHeader
        as="h2"
        title="Reversal approvals"
        description={
          actor.role === "manager"
            ? "Reversals requested on your teams' bookings. The requester can't approve their own request."
            : "Reversals requested by Finance. A manager (own team) or an admin approves; the requester can't approve their own request."
        }
      />
      <PanelCard title={`Waiting for a decision · ${pending.length}`}>
        {pending.length === 0 ? (
          <EmptyState size="sm">No reversals are waiting.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => (
              <li key={r.id} className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200/80 p-3 text-xs shadow-hairline lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0 space-y-1">
                  <p className="font-bold">
                    <Link href={`/dashboard/finance/payments/${r.paymentId}`} className="text-brand hover:underline">
                      Receipt {receipt(r.receiptNo, r.floor)}
                    </Link>{" "}
                    · {formatPrice(r.amount)} · {r.leadName} · Unit {r.unitNo}
                  </p>
                  <p className="text-zinc-800">“{r.reason}”</p>
                  <p className="text-[11px] text-zinc-500">
                    Requested by {r.requestedByName ?? "—"} · {formatDateTime(r.createdAt)}
                  </p>
                </div>
                {canDecide && (r.requestedById !== actor.id || actor.role === "super_admin") ? (
                  <DecideReversalForm requestId={r.id} compact />
                ) : (
                  <p className="text-[11px] text-zinc-500">{r.requestedById === actor.id ? "You requested this; someone else must decide." : "Waiting for a manager or admin."}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelCard>
      <PanelCard title="Recently decided">
        {decided.length === 0 ? (
          <EmptyState size="sm">No decisions yet.</EmptyState>
        ) : (
          <ul className="space-y-1.5">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
                <span>
                  <Link href={`/dashboard/finance/payments/${r.paymentId}`} className="font-bold text-brand hover:underline">
                    Receipt {receipt(r.receiptNo, r.floor)}
                  </Link>{" "}
                  · {formatPrice(r.amount)} · {r.leadName}
                </span>
                <span className={r.status === "approved" ? "font-black text-brand uppercase" : "font-black text-zinc-500 uppercase"}>{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </PanelCard>
    </section>
  );
}
