import Link from "next/link";
import { InterestChip } from "./interest-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/features/leads/format";
import { withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { BOOKING_STAGE_LABELS } from "@/modules/bookings/constants";
import type { BookingStage } from "@/modules/bookings/constants";
import type { ClientSortColumn } from "@/modules/clients/constants";
import type { ClientListRow } from "@/modules/clients/queries";
import { RelationshipPill } from "./relationship-pill";

type Column = { key: string; label: string; sort?: ClientSortColumn };

/** Columns observed in the reference Clients list. */
const COLUMNS: Column[] = [
  { key: "client", label: "Client", sort: "name" },
  { key: "contact", label: "Contact" },
  { key: "relationship", label: "Relationship", sort: "relationship" },
  { key: "interests", label: "Interested in" },
  { key: "investment", label: "Latest investment" },
  { key: "next", label: "Next follow-up", sort: "nextFollowUpAt" },
  { key: "updated", label: "Updated", sort: "updatedAt" },
];

function SortHeader({ column, pathname, params }: { column: Column; pathname: string; params: Record<string, string> }) {
  if (!column.sort) return <>{column.label}</>;
  const current = (params.sort ?? "updatedAt") === column.sort;
  const dir = params.dir === "asc" ? "asc" : "desc";
  const nextDir = current && dir === "desc" ? "asc" : "desc";
  return (
    <Link
      href={withParams(pathname, params, { sort: column.sort, dir: nextDir, page: null })}
      className="group inline-flex items-center gap-1.5 hover:text-zinc-900"
      aria-label={`Sort by ${column.label}`}
    >
      {column.label}
      <span aria-hidden="true" className="flex flex-col text-[7px] leading-[7px]">
        <span className={cn(current && dir === "asc" ? "text-brand" : "text-zinc-300")}>▲</span>
        <span className={cn(current && dir === "desc" ? "text-brand" : "text-zinc-300")}>▼</span>
      </span>
    </Link>
  );
}

/** Clients table in the Leads table style (sticky zinc-100 header, 12px cells). */
export function ClientsTable({
  rows,
  pathname,
  params,
  now,
  emptyMessage,
}: {
  rows: ClientListRow[];
  pathname: string;
  params: Record<string, string>;
  /** Server time the rows were loaded (keeps "overdue" stable between server and client). */
  now: number;
  emptyMessage: string;
}) {
  const sortDir = (key?: ClientSortColumn) =>
    key && (params.sort ?? "updatedAt") === key ? (params.dir === "asc" ? "ascending" : "descending") : undefined;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-hairline">
      <div className="relative max-h-[540px] overflow-auto">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-100">
            <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" aria-sort={sortDir(c.sort)} className="px-3 py-4 whitespace-nowrap">
                  <SortHeader column={c} pathname={pathname} params={params} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const overdue = r.nextFollowUpAt && new Date(r.nextFollowUpAt).getTime() < now;
              return (
                <tr key={r.id} className="border-b border-zinc-100/80 bg-white align-top last:border-b-0 hover:bg-zinc-50/60">
                  <td className="max-w-[240px] px-3 py-2.5">
                    <Link href={`/dashboard/clients/${r.id}`} className="font-bold hover:text-brand hover:underline">
                      {r.name}
                    </Link>
                    <span className="block text-[11px] text-zinc-500">
                      {[r.cityName, r.ownerName ? `Owner ${r.ownerName}` : null].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-700">
                    <span className="block whitespace-nowrap">{r.phone}</span>
                    <span className="block">{r.email ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <RelationshipPill value={r.relationship} />
                  </td>
                  <td className="max-w-[240px] px-3 py-2.5">
                    {r.interests.length ? (
                      <span className="flex flex-wrap gap-1">
                        {r.interests.map((p) => (
                          <InterestChip key={p.projectId} projectName={p.projectName} status={p.status} />
                        ))}
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-700">
                    {r.latestInvestment ? (
                      <Link href={`/dashboard/bookings/${r.latestInvestment.bookingId}`} className="hover:text-brand hover:underline">
                        <span className="block font-semibold whitespace-nowrap">
                          {r.latestInvestment.projectName} · {r.latestInvestment.unitNo}
                        </span>
                        <span className="block text-[11px] text-zinc-500">
                          {BOOKING_STAGE_LABELS[r.latestInvestment.stage as BookingStage]} · {formatDateTime(r.latestInvestment.createdAt)}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={cn(overdue ? "font-semibold text-rose-600" : "text-zinc-900")}>{formatDateTime(r.nextFollowUpAt)}</span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-600">{formatDateTime(r.updatedAt)}</td>
                </tr>
              );
            })}
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
