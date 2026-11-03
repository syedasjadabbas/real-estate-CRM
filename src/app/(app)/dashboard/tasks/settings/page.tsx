import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPrice } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { ReconciliationApply } from "@/features/tasks/components/reconciliation-apply";
import { ProposalSettingsForm } from "@/features/tasks/components/settings-form";
import { proposalReconciliationReport, RECONCILIATION_LABELS } from "@/modules/tasks/price-sync";
import { canDoTask } from "@/modules/tasks/policy";
import { getProposalSettings } from "@/modules/tasks/settings";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Proposal settings" };

export default async function ProposalSettingsPage() {
  const actor = await requirePageUser();
  if (!canDoTask(actor, "settings")) return <RestrictedState />;
  const db = getDb();
  const [settings, recon] = await Promise.all([getProposalSettings(db), proposalReconciliationReport(db, actor)]);
  const toApply = recon.summary.update + recon.summary.updateKeepRows;
  return (
    <section className="space-y-6" aria-label="Proposal settings">
      <PageHeader
        as="h2"
        title="Proposal settings"
        description="App settings for the proposal / payment-plan builder. Proposed defaults pending client confirmation; changes apply to proposals saved afterwards."
        actions={
          <Link href="/dashboard/tasks" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to list
          </Link>
        }
      />
      <ProposalSettingsForm initial={settings} canEdit />
      <PanelCard title="Proposal price reconciliation (Q47)">
        <p className="mb-3 text-xs text-zinc-600">
          Saved plans whose stored unit price or area differs from the unit today. Proposals are updated automatically when a unit changes; this report covers ones saved
          earlier. Applying recalculates the listed proposals, keeps hand-edited schedules and records the previous figures in each proposal&apos;s history. Cancelled proposals and
          booking payment plans are never changed.
        </p>
        {recon.rows.length === 0 ? (
          <EmptyState size="sm">Every saved plan matches its unit&apos;s current price.</EmptyState>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-xs" aria-label="Reconciliation report">
                <thead>
                  <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                    <th scope="col" className="py-2 pr-3">Proposal</th>
                    <th scope="col" className="py-2 pr-3">Unit</th>
                    <th scope="col" className="py-2 pr-3 text-right">Saved / sq ft</th>
                    <th scope="col" className="py-2 pr-3 text-right">Current / sq ft</th>
                    <th scope="col" className="py-2 pr-3 text-right">Total saved → current</th>
                    <th scope="col" className="py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recon.rows.map((r) => (
                    <tr key={r.taskId} className="border-b border-zinc-100 last:border-b-0">
                      <td className="py-2 pr-3">
                        <Link href={`/dashboard/tasks/${r.taskId}`} className="font-bold text-brand hover:underline">
                          {r.title}
                        </Link>
                        <span className="block text-[11px] text-zinc-500">{r.customerName}</span>
                      </td>
                      <td className="py-2 pr-3">{r.unitNo}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatPrice(r.saved.pricePerSqft)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatPrice(r.current.pricePerSqft)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatPrice(r.saved.afterDiscount)} → {formatPrice(r.current.afterDiscount)}
                      </td>
                      <td className="py-2">{RECONCILIATION_LABELS[r.action]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ReconciliationApply count={toApply} />
          </div>
        )}
      </PanelCard>
    </section>
  );
}
