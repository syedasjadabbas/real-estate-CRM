import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { EntryForm } from "@/features/finance/components/entry-forms";
import { formatListedOn, formatPrice } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams } from "@/features/leads/url";
import { businessToday } from "@/modules/bookings/today";
import { ENTRY_KIND_LABELS, listCategories, listEntries } from "@/modules/finance/entries";
import { canDoFinance } from "@/modules/finance/policy";
import { listPaymentMethods } from "@/modules/finance/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Finance · Income & expenses" };

/** FR-200 / FR-201: income and expense records with totals; voided entries are listed only on request. */
export default async function EntriesPage({ searchParams }: PageProps<"/dashboard/finance/entries">) {
  const actor = await requirePageUser();
  if (!canDoFinance(actor, "viewAll")) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const db = getDb();
  const [data, categories, methods] = await Promise.all([listEntries(db, actor, params), listCategories(db), listPaymentMethods(db, { activeOnly: true })]);
  const canRecord = canDoFinance(actor, "record");

  return (
    <section className="space-y-6" aria-label="Income and expenses">
      <PageHeader as="h2" title="Income & expenses" description="Company income and expense records. Entries are never deleted: a voided entry stays on record and is left out of totals." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniStat label="Income" value={formatPrice(data.totals.income)} caption="All matching entries" />
        <MiniStat label="Expenses" value={formatPrice(data.totals.expense)} caption="All matching entries" />
        <MiniStat label="Net" value={formatPrice(data.totals.net)} caption="Income minus expenses" />
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Filter entries">
        {[
          ["q", "Search", <input key="q" type="search" name="q" defaultValue={data.query.q ?? ""} placeholder="Payee, reference, note, category" maxLength={100} className="mt-1 block h-9 w-56 max-w-full rounded-xl border border-zinc-200/80 px-2 text-xs font-semibold" />],
          ["kind", "Kind", <select key="k" name="kind" defaultValue={data.query.kind ?? ""} className="mt-1 block h-9 rounded-xl border border-zinc-200/80 px-2 text-xs font-semibold"><option value="">All</option><option value="income">Income</option><option value="expense">Expense</option></select>],
          ["from", "From", <input key="f" type="date" name="from" defaultValue={data.query.from ?? ""} className="mt-1 block h-9 rounded-xl border border-zinc-200/80 px-2 text-xs font-semibold" />],
          ["to", "To", <input key="t" type="date" name="to" defaultValue={data.query.to ?? ""} className="mt-1 block h-9 rounded-xl border border-zinc-200/80 px-2 text-xs font-semibold" />],
        ].map(([k, label, input]) => (
          <label key={String(k)} className="text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">
            {label}
            {input}
          </label>
        ))}
        <label className="flex items-center gap-1.5 pb-2 text-xs font-semibold text-zinc-700">
          <input type="checkbox" name="voided" value="include" defaultChecked={data.query.voided === "include"} />
          Include voided
        </label>
        <button type="submit" className="h-9 rounded-xl bg-brand px-3.5 text-xs font-bold text-white">
          Apply
        </button>
      </form>

      <PanelCard title={`Entries · ${data.total}`}>
        {data.rows.length === 0 ? (
          <EmptyState size="sm">No entries match.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className="py-2 pr-3">Date</th>
                  <th scope="col" className="py-2 pr-3">Kind</th>
                  <th scope="col" className="py-2 pr-3">Category</th>
                  <th scope="col" className="py-2 pr-3">Payee / reference</th>
                  <th scope="col" className="py-2 pr-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-b-0">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <Link href={`/dashboard/finance/entries/${r.id}`} className="font-bold text-brand hover:underline">
                        {formatListedOn(r.entryDate)}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      {ENTRY_KIND_LABELS[r.kind]} {r.voidedAt ? <StatusTag tone="neutral">Voided</StatusTag> : null}
                    </td>
                    <td className="py-2 pr-3">{r.categoryName}</td>
                    <td className="py-2 pr-3">{[r.payee, r.reference].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={`py-2 pr-3 text-right font-semibold tabular-nums ${r.voidedAt ? "text-zinc-400 line-through" : ""}`}>{formatPrice(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>
      {data.total > 0 ? <Pagination page={data.page} pageCount={data.pageCount} total={data.total} params={params} /> : null}

      {canRecord ? (
        <PanelCard title="Record income or expense">
          <EntryForm
            categories={categories}
            methods={methods.map((m) => ({ id: m.id, name: m.name }))}
            initial={{ kind: "expense", categoryId: "", amount: "", entryDate: businessToday(), methodId: "", reference: "", payee: "", note: "" }}
          />
        </PanelCard>
      ) : null}
    </section>
  );
}
