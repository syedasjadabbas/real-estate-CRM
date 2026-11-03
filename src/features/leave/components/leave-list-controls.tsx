import Link from "next/link";
import { withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { LEAVE_TYPE_LABELS, LEAVE_TYPES } from "@/modules/leave/rules";
import type { LeaveSortColumn } from "@/modules/leave/service";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  cancel_requested: "Cancellation requested",
  cancelled: "Cancelled",
};
const field = "mt-1 block h-9 rounded-xl border border-zinc-200/80 bg-white px-2 text-xs font-semibold";
const labelClass = "text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase";

/** Year, search, status and type for HR → Leave (a plain GET form: works before hydration). */
export function LeaveListFilters({ path, params, years, year }: { path: string; params: Record<string, string>; years: number[]; year: number }) {
  const active = Boolean(params.q || params.status || params.type);
  return (
    <form method="get" action={path} className="flex flex-wrap items-end gap-2" aria-label="Filter leave requests">
      <label className={labelClass}>
        Year
        <select name="year" defaultValue={String(year)} className={field}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Search
        <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Employee or reason" maxLength={100} className={cn(field, "w-52 max-w-full")} />
      </label>
      <label className={labelClass}>
        Status
        <select name="status" defaultValue={params.status ?? ""} className={field}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Leave type
        <select name="type" defaultValue={params.type ?? ""} className={field}>
          <option value="">All types</option>
          {LEAVE_TYPES.map((t) => (
            <option key={t} value={t}>
              {LEAVE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      {params.sort ? <input type="hidden" name="sort" value={params.sort} /> : null}
      {params.dir ? <input type="hidden" name="dir" value={params.dir} /> : null}
      <button type="submit" className="h-9 rounded-xl bg-brand px-3.5 text-xs font-bold text-white">
        Apply
      </button>
      {active ? (
        <Link href={withParams(path, params, { q: null, status: null, type: null, page: null })} className="h-9 rounded-xl border border-zinc-200/80 px-3.5 text-xs leading-9 font-bold text-zinc-700 hover:bg-zinc-50">
          Clear all
        </Link>
      ) : null}
    </form>
  );
}

/** A sortable column header (newest requests first by default). */
export function LeaveSortHeader({ path, params, column, label, sort, dir }: { path: string; params: Record<string, string>; column: LeaveSortColumn; label: string; sort: LeaveSortColumn; dir: "asc" | "desc" }) {
  const current = sort === column;
  const nextDir = current && dir === "desc" ? "asc" : "desc";
  return (
    <Link href={withParams(path, params, { sort: column, dir: nextDir, page: null })} className="group inline-flex items-center gap-1.5 hover:text-zinc-900" aria-label={`Sort by ${label}`}>
      {label}
      <span aria-hidden="true" className="flex flex-col text-[7px] leading-[7px]">
        <span className={cn(current && dir === "asc" ? "text-brand" : "text-zinc-300")}>▲</span>
        <span className={cn(current && dir === "desc" ? "text-brand" : "text-zinc-300")}>▼</span>
      </span>
    </Link>
  );
}
