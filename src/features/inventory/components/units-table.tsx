import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { SortTh } from "@/features/leads/components/sort-header";
import { SALE_MODEL_LABELS, type UnitSortColumn } from "@/modules/inventory/constants";
import type { UnitRow } from "@/modules/inventory/queries";
import { formatArea, formatBookedOn, formatPrice } from "../format";
import { UnitStatusPill } from "./status-pill";

/** Reference columns (MODULES_AND_FEATURES.md §5) minus "Sales", whose meaning is unknown. */
const COLUMNS: { label: string; sort?: UnitSortColumn }[] = [
  { label: "#" },
  { label: "Project", sort: "project" },
  { label: "Floor", sort: "floor" },
  { label: "Unit", sort: "unit" },
  { label: "Sale model", sort: "saleModel" },
  { label: "Area", sort: "area" },
  { label: "Base price", sort: "price" },
  { label: "Nature", sort: "nature" },
  { label: "Category", sort: "category" },
  { label: "Status", sort: "status" },
  { label: "Bed", sort: "bedrooms" },
  { label: "Booked on", sort: "bookedOn" },
];

/** Units table in the Leads table style (540px scroll area, sticky zinc-100 header, 12px cells). */
export function UnitsTable({ rows, offset, emptyMessage, params, sort, dir }: { rows: UnitRow[]; offset: number; emptyMessage: string; params: Record<string, string>; sort: UnitSortColumn | undefined; dir: "asc" | "desc" }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-hairline">
      <div className="relative max-h-[540px] overflow-auto">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-100">
            <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
              {COLUMNS.map((c) =>
                c.sort ? (
                  <SortTh key={c.label} path="/dashboard/inventory" params={params} column={c.sort} label={c.label} sort={sort} dir={dir} className="px-3 py-4 whitespace-nowrap" />
                ) : (
                  <th key={c.label} scope="col" className="px-3 py-4 whitespace-nowrap">
                    {c.label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-b border-zinc-100/80 bg-white align-top last:border-b-0 hover:bg-zinc-50/60">
                <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{offset + i + 1}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.projectName}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.floor ?? "—"}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <Link href={`/dashboard/inventory/${r.id}`} className="font-bold hover:text-brand hover:underline">
                    {r.unitNo}
                  </Link>
                  {r.block ? <span className="block text-[11px] text-zinc-500">Block {r.block}</span> : null}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{SALE_MODEL_LABELS[r.saleModel]}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-800 tabular-nums">{formatArea(r.areaSqft)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap font-semibold text-zinc-900 tabular-nums">{formatPrice(r.basePrice)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.nature ?? "—"}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.category ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <UnitStatusPill status={r.status} />
                </td>
                <td className="px-3 py-2.5 text-zinc-700 tabular-nums">{r.bedrooms ?? "—"}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-600">{r.bookedOn ? formatBookedOn(r.bookedOn) : "—"}</td>
              </tr>
            ))}
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
