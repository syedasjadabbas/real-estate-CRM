import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/features/leads/format";
import { withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { hasPlan, type TaskSortColumn } from "@/modules/tasks/constants";
import type { TaskListRow } from "@/modules/tasks/queries";
import { OverdueChip, TaskStatusPill, TaskTypeTag } from "./task-pills";

type Column = { label: string; sort?: TaskSortColumn };

/** Reference columns: Title, Type, Status, Due, Assignee, Updated (sortable) and Actions. */
const COLUMNS: Column[] = [
  { label: "Title", sort: "title" },
  { label: "Type", sort: "type" },
  { label: "Status", sort: "status" },
  { label: "Due", sort: "dueAt" },
  { label: "Assignee", sort: "assignee" },
  { label: "Updated", sort: "updatedAt" },
  { label: "Actions" },
];

function SortHeader({ column, params }: { column: Column; params: Record<string, string> }) {
  if (!column.sort) return <>{column.label}</>;
  const current = (params.sort ?? "updatedAt") === column.sort;
  const dir = params.dir === "asc" ? "asc" : "desc";
  const nextDir = current && dir === "desc" ? "asc" : "desc";
  return (
    <Link
      href={withParams("/dashboard/tasks", params, { sort: column.sort, dir: nextDir, page: null })}
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

export function TasksTable({ rows, params, emptyMessage }: { rows: TaskListRow[]; params: Record<string, string>; emptyMessage: string }) {
  const ariaSort = (key?: TaskSortColumn) => (key && (params.sort ?? "updatedAt") === key ? (params.dir === "asc" ? "ascending" : "descending") : undefined);
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-hairline">
      <div className="relative max-h-[540px] overflow-auto">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-100">
            <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
              {COLUMNS.map((c) => (
                <th key={c.label} scope="col" aria-sort={ariaSort(c.sort)} className="px-3 py-4 whitespace-nowrap">
                  <SortHeader column={c} params={params} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100/80 bg-white align-top last:border-b-0 hover:bg-zinc-50/60">
                <td className="max-w-[280px] px-3 py-2.5">
                  <Link href={`/dashboard/tasks/${r.id}`} className="block font-bold break-words hover:text-brand hover:underline">
                    {r.title}
                  </Link>
                  {r.leadName ? (
                    <span className="block text-[11px] font-semibold text-zinc-500">
                      {r.leadName} · {r.leadCode}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  <TaskTypeTag type={r.type} />
                </td>
                <td className="px-3 py-2.5">
                  <TaskStatusPill status={r.status} />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="flex flex-col items-start gap-1">
                    <span className={cn("font-semibold", r.overdue ? "text-rose-600" : "text-zinc-700")}>{r.dueAt ? formatDateTime(r.dueAt) : "—"}</span>
                    {r.overdue ? <OverdueChip /> : null}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-800">{r.assigneeName}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-600">{formatDateTime(r.updatedAt)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="flex items-center gap-3">
                    <Link href={`/dashboard/tasks/${r.id}`} className="text-xs font-bold text-brand hover:underline" aria-label={`Open task ${r.title}`}>
                      Open →
                    </Link>
                    {hasPlan(r.type) ? (
                      <Link href={`/print/proposal/${r.id}`} target="_blank" className="text-xs font-bold text-zinc-700 hover:underline" aria-label={`Print plan for ${r.title}`}>
                        Print
                      </Link>
                    ) : null}
                  </span>
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
