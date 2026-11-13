import { Phone } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { INBOUND_LABELS, PRIORITY_LABELS, type SortColumn } from "@/modules/leads/constants";
import { telHref } from "@/modules/leads/phone";
import type { LeadListRow } from "@/modules/leads/queries";
import { formatDateTime, formatDuration, since } from "../format";
import { withParams } from "../url";
import { SourcePill, StagePill } from "./chips";
import { VerificationBadge } from "./verification";
import { CopyCodeButton, FavoriteButton, FollowUpButtons } from "./row-actions";

type Column = { key: string; label: string; sort?: SortColumn; className?: string };

const COLUMNS: Column[] = [
  { key: "star", label: "★", className: "w-10 px-2" },
  { key: "code", label: "Code", sort: "code" },
  { key: "lead", label: "Lead", sort: "name" },
  { key: "contact", label: "Contact", sort: "phone" },
  { key: "city", label: "City", sort: "city" },
  { key: "inStage", label: "In stage", sort: "inStage" },
  { key: "agent", label: "Agent", sort: "owner" },
  { key: "created", label: "Created", sort: "createdAt" },
  { key: "modified", label: "Modified", sort: "modified" },
  { key: "firstTouch", label: "First touch", sort: "firstTouch" },
  { key: "next", label: "Next follow-up", sort: "next" },
  { key: "status", label: "Status", sort: "stage" },
  { key: "source", label: "Source", sort: "source" },
  { key: "inbound", label: "Inbound", sort: "inbound" },
  { key: "budget", label: "Budget", sort: "budget" },
  { key: "project", label: "Project", sort: "project" },
  { key: "priority", label: "Priority", sort: "priority" },
  { key: "size", label: "Size", sort: "size" },
  { key: "gender", label: "Gender", sort: "gender" },
  { key: "comment", label: "Comment", sort: "comment" },
  { key: "lostReason", label: "Lost reason", sort: "lostReason" },
  { key: "externalId", label: "External ID", sort: "externalId" },
  { key: "followUp", label: "Follow-up", className: "px-2" },
];

function SortHeader({ column, pathname, params, defaultSort }: { column: Column; pathname: string; params: Record<string, string>; defaultSort: SortColumn | null }) {
  if (!column.sort) return <>{column.label}</>;
  const current = (params.sort ?? defaultSort) === column.sort;
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

/**
 * Leads table matching the reference: 540px scroll area, sticky zinc-100 header,
 * 10px/900 uppercase headers, 12px cells, pills for status/source, ADD/DONE follow-up buttons.
 */
export function LeadsTable({
  rows,
  pathname,
  params,
  showOriginal = false,
  canEdit,
  now,
  emptyMessage = "No leads match these filters.",
  defaultSort = "createdAt",
}: {
  rows: LeadListRow[];
  pathname: string;
  params: Record<string, string>;
  showOriginal?: boolean;
  canEdit: boolean;
  /** Server time the rows were loaded (keeps "in stage"/overdue stable between server and client). */
  now: number;
  emptyMessage?: string;
  /** The column the unsorted list is ordered by, or null when it has its own order (Regenerated). */
  defaultSort?: SortColumn | null;
}) {
  const sortDir = (key?: SortColumn) =>
    key && (params.sort ?? defaultSort) === key ? (params.dir === "asc" ? "ascending" : "descending") : undefined;
  const columns = showOriginal
    ? [...COLUMNS.slice(0, 3), { key: "original", label: "Original" }, ...COLUMNS.slice(3)]
    : COLUMNS;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-hairline">
      <div className="relative max-h-[540px] overflow-auto">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-100">
            <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
              {columns.map((c) => (
                <th key={c.key} scope="col" aria-sort={sortDir(c.sort)} className={cn("px-3 py-4 whitespace-nowrap", c.className)}>
                  <SortHeader column={c} pathname={pathname} params={params} defaultSort={defaultSort} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const overdue = r.nextFollowUpAt && new Date(r.nextFollowUpAt).getTime() < now;
              const closed = r.stage === "lost_lead" || r.stage === "booked";
              return (
                <tr key={r.id} className="border-b border-zinc-100/80 bg-white align-top last:border-b-0 hover:bg-zinc-50/60">
                  <td className="px-2 py-2.5">
                    <FavoriteButton leadId={r.id} initial={r.isFavorite} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1">
                      <span className="font-bold tracking-[0.05em] text-zinc-700">{r.code}</span>
                      <CopyCodeButton code={r.code} />
                    </span>
                  </td>
                  <td className="max-w-[220px] px-3 py-2.5">
                    <Link href={`/dashboard/leads/${r.id}`} className="font-bold hover:text-brand hover:underline">
                      {r.name}
                    </Link>
                    {r.isRegenerated ? (
                      <span className="mt-1 block w-fit rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-black tracking-[0.05em] text-sky-700 uppercase">
                        Regenerated
                      </span>
                    ) : null}
                    {r.duplicateOfId ? (
                      <span className="mt-1 block w-fit rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-black tracking-[0.05em] text-amber-800 uppercase">
                        Duplicate
                      </span>
                    ) : null}
                  </td>
                  {showOriginal ? (
                    <td className="px-3 py-2.5 font-bold tracking-[0.05em] text-zinc-700">{r.originalCode ?? "—"}</td>
                  ) : null}
                  <td className="px-3 py-2.5 text-zinc-700">
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      {/* Calls from the list without opening the lead: the phone dials through the tel: link. */}
                      <a
                        href={telHref(r.phoneCountryCode, r.phoneNumber)}
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand ring-1 ring-brand/20 transition-colors hover:bg-brand hover:text-white"
                        aria-label={`Call ${r.name} on ${r.phone}`}
                        title={`Call ${r.phone}`}
                      >
                        <Phone aria-hidden="true" className="size-3.5" />
                      </a>
                      <span>{r.phone}</span>
                    </span>
                    <span className="block">{r.email ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-700">{r.cityName ?? "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{since(r.stageChangedAt, now)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-800">{r.ownerName ?? "Unassigned"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-600">{formatDateTime(r.createdAt)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-600">{formatDateTime(r.updatedAt)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.firstTouchAt ? (
                      <>
                        <span className="block font-bold text-zinc-900">
                          {formatDuration(new Date(r.firstTouchAt).getTime() - new Date(r.createdAt).getTime())}
                        </span>
                        <span className="block text-[11px] text-zinc-600">{formatDateTime(r.firstTouchAt)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={cn(overdue ? "font-semibold text-rose-600" : "text-zinc-900")}>
                      {formatDateTime(r.nextFollowUpAt)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex flex-wrap items-center gap-1">
                      <StagePill stage={r.stage} />
                      <VerificationBadge status={r.verification} />
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <SourcePill>{r.sourceName ?? INBOUND_LABELS[r.inboundChannel]}</SourcePill>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{INBOUND_LABELS[r.inboundChannel]}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-800 uppercase">{r.budgetName ?? "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.projectName}</td>
                  <td className="px-3 py-2.5 text-zinc-800">
                    {r.priority === "none" ? <span className="text-zinc-400">—</span> : PRIORITY_LABELS[r.priority]}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-800">{r.desiredSize ?? "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.gender ?? "—"}</td>
                  <td className="max-w-[208px] px-3 py-2.5">
                    <p className="line-clamp-2 text-zinc-700">{r.latestComment ?? "—"}</p>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.lostReasonName ?? "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.externalId ?? "—"}</td>
                  <td className="px-2 py-2.5">
                    <FollowUpButtons
                      leadId={r.id}
                      leadName={r.name}
                      hasPending={Boolean(r.nextFollowUpAt)}
                      disabled={!canEdit || closed}
                    />
                  </td>
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
