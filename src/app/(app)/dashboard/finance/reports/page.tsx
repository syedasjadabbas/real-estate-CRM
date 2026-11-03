import { Download } from "lucide-react";
import { incomeExpenseByMonth } from "@/modules/finance/entries";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { formatPrice } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { flattenParams } from "@/features/leads/url";
import { canDoFinance } from "@/modules/finance/policy";
import { collectionsByProject, outstandingBy } from "@/modules/finance/reports";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Finance · Reports" };

function Table({ head, rows, foot }: { head: string[]; rows: ReactNode[][]; foot: ReactNode[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
      <table className="w-full min-w-max border-collapse text-left text-xs">
        <thead className="bg-zinc-100">
          <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
            {head.map((h, i) => (
              <th key={h} scope="col" className={i === 0 ? "px-3 py-3" : "px-3 py-3 text-right"}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-100/80 last:border-b-0">
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? "px-3 py-2.5 font-semibold" : "px-3 py-2.5 text-right whitespace-nowrap tabular-nums"}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-zinc-50">
          <tr className="font-black">
            {foot.map((c, j) => (
              <td key={j} className={j === 0 ? "px-3 py-2.5" : "px-3 py-2.5 text-right whitespace-nowrap tabular-nums"}>
                {c}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const exportLink = (report: string, extra = "") => (
  <a href={`/api/v1/finance/reports/export?report=${report}${extra}`} download className={buttonClasses({ variant: "secondary", className: "h-[33px] px-3 text-xs" })}>
    <Download aria-hidden="true" className="size-3.5" />
    Export CSV
  </a>
);

/** FR-205 reports with confirmed definitions (finance roles: super admin, admin, accountant). */
export default async function FinanceReportsPage({ searchParams }: PageProps<"/dashboard/finance/reports">) {
  const actor = await requirePageUser();
  if (!canDoFinance(actor, "viewAll")) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const db = getDb();
  const [collections, byProject, byAgent, ie] = await Promise.all([collectionsByProject(db, actor, params), outstandingBy(db, actor, "project"), outstandingBy(db, actor, "agent"), incomeExpenseByMonth(db, actor, params)]);
  const { from, to } = collections.range;
  const c = collections.totals;

  return (
    <section className="space-y-6" aria-label="Finance reports">
      <PageHeader
        as="h2"
        title="Reports"
        description="Collections by project for a date range, and outstanding balances by project and by sales agent. Totals are computed from the payment ledger; every CSV export is audited."
      />

      <PanelCard title="Collections by project">
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">
            From
            <input type="date" name="from" defaultValue={from} className="mt-1 block h-9 rounded-xl border border-zinc-200/80 px-2 text-xs font-semibold text-zinc-900" />
          </label>
          <label className="text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">
            To
            <input type="date" name="to" defaultValue={to} className="mt-1 block h-9 rounded-xl border border-zinc-200/80 px-2 text-xs font-semibold text-zinc-900" />
          </label>
          <button type="submit" className={buttonClasses({ variant: "primary", className: "h-9 px-3.5 text-xs" })}>
            Apply
          </button>
          <span className="ml-auto">{exportLink("collections", `&from=${from}&to=${to}`)}</span>
        </form>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MiniStat label="Received" value={formatPrice(c.received)} caption={`${c.receipts} receipts`} />
          <MiniStat label="Reversed" value={formatPrice(c.reversed)} caption={`${c.reversals} reversals`} />
          <MiniStat label="Net collected" value={formatPrice(c.net)} caption={`${from} to ${to}`} />
        </div>
        {collections.rows.length === 0 ? (
          <EmptyState size="sm">No payments or reversals dated in this range.</EmptyState>
        ) : (
          <Table
            head={["Project", "Receipts", "Received", "Reversals", "Reversed", "Net collected"]}
            rows={collections.rows.map((r) => [r.project, r.receipts, formatPrice(r.received), r.reversals, formatPrice(r.reversed), formatPrice(r.net)])}
            foot={["Total", c.receipts, formatPrice(c.received), c.reversals, formatPrice(c.reversed), formatPrice(c.net)]}
          />
        )}
        <p className="mt-3 text-[11px] text-zinc-500">
          Each ledger entry counts on its own date: payments add, reversals subtract. Refunds and credits on cancellation are not defined yet (client question Q-F10).
        </p>
      </PanelCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {[
          { title: "Outstanding by project", report: "outstanding_project", data: byProject, label: "Project" },
          { title: "Outstanding by sales agent", report: "outstanding_agent", data: byAgent, label: "Agent" },
        ].map(({ title, report, data, label }) => (
          <PanelCard key={report} title={title} className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[11px] text-zinc-500">As of today · all bookings except cancelled · total sale − net paid.</p>
              {exportLink(report)}
            </div>
            {data.rows.length === 0 ? (
              <EmptyState size="sm">No bookings with balances.</EmptyState>
            ) : (
              <Table
                head={[label, "Bookings", "Total sale", "Paid", "Outstanding"]}
                rows={data.rows.map((r) => [r.label, r.bookings, formatPrice(r.total), formatPrice(r.paid), formatPrice(r.outstanding)])}
                foot={["Total", data.totals.bookings, formatPrice(data.totals.total), formatPrice(data.totals.paid), formatPrice(data.totals.outstanding)]}
              />
            )}
          </PanelCard>
        ))}
      </div>

      <PanelCard title={`Income vs expense by month · ${ie.year}`}>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">
            Year
            <input type="number" name="year" min={2000} max={2100} defaultValue={ie.year} className="mt-1 block h-9 w-24 rounded-xl border border-zinc-200/80 px-2 text-xs font-semibold text-zinc-900" />
          </label>
          <button type="submit" className={buttonClasses({ variant: "primary", className: "h-9 px-3.5 text-xs" })}>
            Apply
          </button>
          <span className="ml-auto">{exportLink("income_expense", `&year=${ie.year}`)}</span>
        </form>
        <Table
          head={["Month", "Income", "Expense", "Net"]}
          rows={ie.months.map((m) => [m.month, formatPrice(m.income), formatPrice(m.expense), formatPrice(m.net)])}
          foot={["Total", formatPrice(ie.totals.income), formatPrice(ie.totals.expense), formatPrice(ie.totals.net)]}
        />
      </PanelCard>
    </section>
  );
}
