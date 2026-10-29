import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { BookingStagePill } from "@/features/bookings/components/stage-pill";
import { OutstandingToolbar } from "@/features/finance/components/outstanding-toolbar";
import { formatPrice } from "@/features/inventory/format";
import { flattenParams } from "@/features/leads/url";
import { canDoFinance } from "@/modules/finance/policy";
import { outstandingBookings } from "@/modules/finance/views";
import { inventoryProjects } from "@/modules/inventory/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Finance · Outstanding" };

const COLUMNS = ["Lead", "Unit", "Project", "Sales agent", "Stage", "Total sale", "Paid", "Outstanding", "30% milestone"];

export default async function OutstandingPage({ searchParams }: PageProps<"/dashboard/finance/outstanding">) {
  const actor = await requirePageUser();
  if (!canDoFinance(actor, "viewAll")) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const db = getDb();
  const [result, projects] = await Promise.all([outstandingBookings(db, actor, params), inventoryProjects(db)]);

  return (
    <section className="space-y-6" aria-label="Outstanding balances">
      <PageHeader
        as="h2"
        title="Outstanding balances"
        description="Per booking: total sale − posted payments (net of reversals). Overdue against a schedule needs installment plans, which aren't set up yet."
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniStat label="Total sale" value={formatPrice(result.totals.total)} caption={`${result.rows.length} bookings`} />
        <MiniStat label="Paid" value={formatPrice(result.totals.paid)} caption="Posted payments − reversals" />
        <MiniStat label="Outstanding" value={formatPrice(result.totals.outstanding)} caption="Still to collect" />
      </div>
      <OutstandingToolbar params={params} projects={projects} />
      <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-hairline">
        <div className="relative max-h-[540px] overflow-auto">
          <table className="w-full min-w-max border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-zinc-100">
              <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                {COLUMNS.map((c) => (
                  <th key={c} scope="col" className="px-3 py-4 whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.bookingId} className="border-b border-zinc-100/80 bg-white align-top last:border-b-0 hover:bg-zinc-50/60">
                  <td className="max-w-[200px] px-3 py-2.5">
                    <Link href={`/dashboard/bookings/${r.bookingId}`} className="font-bold hover:text-brand hover:underline">
                      {r.leadName}
                    </Link>
                    <span className="block text-[11px] font-bold tracking-[0.05em] text-zinc-500">{r.leadCode}</span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.unitNo}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.projectName}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.agentName ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <BookingStagePill stage={r.stage} />
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{formatPrice(r.totalSale)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{formatPrice(r.paid)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-semibold tabular-nums">{formatPrice(r.outstanding)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{r.milestoneMet ? "Met" : "Not met"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.rows.length === 0 ? (
            <div className="p-4">
              <EmptyState>No bookings match these filters.</EmptyState>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
