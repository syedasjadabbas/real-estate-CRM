import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPrice } from "@/features/inventory/format";
import { formatDateTime } from "@/features/leads/format";
import type { BookingRow } from "@/modules/bookings/queries";
import { BookingStagePill, HoldOverdueChip } from "./stage-pill";

/** Reference columns: Lead, Sales agent, Unit, Project, Stage, Paid, Updated, Open. */
const COLUMNS = ["Lead", "Sales agent", "Unit", "Project", "Stage", "Paid", "Updated", ""];

/** Bookings table in the Leads table style. Paid comes from posted Finance records. */
export function BookingsTable({ rows, emptyMessage }: { rows: BookingRow[]; emptyMessage: string }) {
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
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100/80 bg-white align-top last:border-b-0 hover:bg-zinc-50/60">
                <td className="max-w-[220px] px-3 py-2.5">
                  <span className="block font-bold">{r.leadName}</span>
                  <span className="block text-[11px] font-bold tracking-[0.05em] text-zinc-500">{r.leadCode}</span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-800">{r.agentName ?? "—"}</td>
                <td className="px-3 py-2.5 whitespace-nowrap font-semibold text-zinc-900">{r.unitNo}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.projectName}</td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-col items-start gap-1">
                    <BookingStagePill stage={r.stage} />
                    {r.holdOverdue ? <HoldOverdueChip /> : null}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700 tabular-nums" title="Posted payments minus approved reversals">
                  {formatPrice(r.paid)} <span className="text-zinc-400">/ {formatPrice(r.total)}</span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-600">{formatDateTime(r.updatedAt)}</td>
                <td className="px-3 py-2.5">
                  <Link href={`/dashboard/bookings/${r.id}`} className="text-xs font-bold text-brand hover:underline" aria-label={`Open booking for ${r.leadName}`}>
                    Open →
                  </Link>
                </td>
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

/** Compact list for lead, unit and client pages. */
export function BookingsMiniList({ rows, empty }: { rows: BookingRow[]; empty: string }) {
  if (rows.length === 0) return <EmptyState size="sm">{empty}</EmptyState>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
          <div className="min-w-0">
            <Link href={`/dashboard/bookings/${r.id}`} className="font-bold hover:text-brand hover:underline">
              Unit {r.unitNo} · {r.leadName}
            </Link>
            <p className="text-[11px] text-zinc-500">
              {r.projectName} · {formatPrice(r.total)} · {formatDateTime(r.createdAt)}
            </p>
          </div>
          <BookingStagePill stage={r.stage} />
        </li>
      ))}
    </ul>
  );
}
