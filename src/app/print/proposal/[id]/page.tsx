import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { brand } from "@/config/brand";
import { formatArea, formatListedOn, formatPrice } from "@/features/inventory/format";
import { rowsTotal } from "@/modules/tasks/plan";
import { canDoTask } from "@/modules/tasks/policy";
import { getTaskDetail, type TaskDetail } from "@/modules/tasks/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Proposal" };

/**
 * Printed section in A4 flow; headings are the observed section names. Short sections stay on one
 * page; a long one (the schedule) may break across pages, with its heading kept above the first rows.
 */
function Section({ title, children, splittable = false }: { title: string; children: ReactNode; splittable?: boolean }) {
  return (
    <section className={cn("border-t border-zinc-200 pt-5", !splittable && "break-inside-avoid")}>
      <h2 className="mb-3 break-after-avoid text-[11px] font-black tracking-[0.2em] text-[#107c41] uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-zinc-100 py-1.5 text-sm">
      <span className="text-zinc-600">{label}</span>
      <span className="text-right font-bold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Printable proposal (FR-091) with data sections only (decision 29 Oct 2026). The sections with no
 * documented content print only the text the user wrote for them, and are omitted when blank.
 */
export default async function ProposalPrintPage({ params }: PageProps<"/print/proposal/[id]">) {
  const actor = await requirePageUser();
  if (!canDoTask(actor, "view")) notFound();
  const { id } = await params;
  let detail: TaskDetail;
  try {
    detail = await getTaskDetail(getDb(), actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const p = detail.task.proposal;
  if (!p) notFound();
  const project = p.printTitle || detail.projectName;

  return (
    <div className="min-h-screen bg-zinc-100 py-6 print:min-h-0 print:bg-white print:py-0">
      {/* The app background is grey; printed pages (with "Background graphics" on) must stay white. */}
      <style>{"@media print { html, body { background: #fff !important; } }"}</style>
      {detail.unitChanged ? (
        <p role="note" className="mx-auto mb-3 max-w-[794px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 print:hidden">
          The unit&apos;s price changed after this proposal was saved. The Super Admin can save the proposal again (or apply the price reconciliation in Tasks settings) so the figures use the current price.
        </p>
      ) : null}
      <div className="mx-auto mb-4 flex max-w-[794px] flex-wrap items-center justify-between gap-2 px-4 print:hidden">
        <Link href={`/dashboard/tasks/${detail.task.id}`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Back to task
        </Link>
        <PrintButton />
      </div>
      <article className="mx-auto max-w-[794px] space-y-6 bg-white px-6 py-8 shadow-hairline sm:px-12 sm:py-10 print:max-w-none print:px-0 print:py-0 print:shadow-none">
        <header className="space-y-4 pb-2">
          <p className="text-xs font-black tracking-[0.2em] text-zinc-500 uppercase">{p.customHeader || brand.name}</p>
          <h1 className="text-3xl leading-tight font-black tracking-[-0.025em]">Exclusive Investment Proposal</h1>
          {project ? <p className="text-lg font-bold text-[#107c41]">{project}</p> : null}
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label="Prepared for" value={p.clientName || p.customerName} />
            <Row label="Date" value={p.preparedDate ? formatListedOn(p.preparedDate) : "—"} />
            <Row label="Prepared by" value={[p.preparedByName, p.preparedByTitle].filter(Boolean).join(", ") || "—"} />
          </div>
        </header>

        <Section title="Project Overview">
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label="Project" value={project || "—"} />
            <Row label="Apartment no" value={p.apartmentNo ?? "—"} />
            <Row label="Unit" value={p.unitDescription ?? "—"} />
            <Row label="Area" value={formatArea(p.areaSqft)} />
          </div>
        </Section>

        <Section title="Investment Summary">
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label="Price per sq ft" value={formatPrice(p.pricePerSqft)} />
            <Row label="Total sale value" value={formatPrice(p.totalList)} />
            <Row label="Discount" value={`${p.discountPct}%`} />
            <Row label="Sale value after discount" value={formatPrice(p.afterDiscount)} />
            <Row label={`Down payment (${p.downPaymentPct}%)`} value={formatPrice(p.downPayment)} />
            <Row label={`${p.installmentCount} installments of`} value={formatPrice(p.eachInstallment)} />
            {p.roiAnnual !== null ? <Row label="Expected ROI annually" value={formatPrice(p.roiAnnual)} /> : null}
          </div>
        </Section>

        {p.freeNightVouchers || p.bonuses ? (
          <Section title="Exclusive Bonuses & Incentives">
            {p.freeNightVouchers ? <Row label="Free night vouchers" value={p.freeNightVouchers} /> : null}
            {p.bonuses ? <p className="mt-2 text-sm whitespace-pre-wrap">{p.bonuses}</p> : null}
          </Section>
        ) : null}

        <Section title="Payment Schedule" splittable>
          {detail.rows.length === 0 ? (
            <p className="text-sm text-zinc-500">No schedule.</p>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b-2 border-zinc-300 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 pr-2">Installment</th>
                  <th className="py-2 pr-2">Description</th>
                  <th className="py-2 pr-2">Progress</th>
                  <th className="py-2 pr-2">Due date</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {detail.rows.map((r) => (
                  <tr key={r.seq} className="break-inside-avoid border-b border-zinc-100">
                    <td className="py-1.5 pr-2 tabular-nums">{r.seq}</td>
                    <td className="py-1.5 pr-2 font-semibold">{r.label}</td>
                    <td className="py-1.5 pr-2">{r.description ?? ""}</td>
                    <td className="py-1.5 pr-2">{r.progress ?? ""}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">{r.dueOn ? formatListedOn(r.dueOn) : ""}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatPrice(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              {/* Footer shown once at the end: a repeating table footer would print "Total" on every page. */}
              <tfoot className="print:table-row-group">
                <tr className="border-t-2 border-zinc-300 font-black">
                  <td colSpan={5} className="py-2">
                    Total
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatPrice(rowsTotal(detail.rows))}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Section>

        {p.whyActNow ? (
          <Section title="Why Act Now">
            <p className="text-sm whitespace-pre-wrap">{p.whyActNow}</p>
          </Section>
        ) : null}
        {p.nextSteps ? (
          <Section title="Next Steps">
            <p className="text-sm whitespace-pre-wrap">{p.nextSteps}</p>
          </Section>
        ) : null}
      </article>
    </div>
  );
}
