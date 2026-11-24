import { NEW_LEAD_HOURS } from "@/modules/leads/constants";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { INBOUND_LABELS, PRIORITY_LABELS, type SortColumn } from "@/modules/leads/constants";
import { telHref } from "@/modules/leads/phone";
import type { LeadListRow } from "@/modules/leads/queries";
import { formatDateTime } from "../format";
import { withParams } from "../url";
import { SourcePill, StagePill } from "./chips";
import { LeadContact } from "./lead-contact";
import { VerificationBadge } from "./verification";
import { CopyCodeButton, FavoriteButton, FollowUpButtons } from "./row-actions";

type Column = { key: string; label: string; sort?: SortColumn; className?: string };

/** Related columns sit together under one heading (client, 23 Nov 2026). */
const GROUPS: { label: string; columns: Column[] }[] = [
  {
    label: "Customer",
    columns: [
      { key: "star", label: "★", className: "w-10 px-2" },
      { key: "code", label: "Code", sort: "code" },
      { key: "lead", label: "Name", sort: "name" },
      { key: "contact", label: "Contact", sort: "phone" },
      { key: "city", label: "City", sort: "city" },
      { key: "gender", label: "Gender", sort: "gender" },
    ],
  },
  {
    label: "Pipeline",
    columns: [
      { key: "project", label: "Project", sort: "project" },
      { key: "status", label: "Status", sort: "stage" },
      { key: "priority", label: "Priority", sort: "priority" },
      { key: "lostReason", label: "Lost reason", sort: "lostReason" },
    ],
  },
  {
    label: "Activity",
    columns: [
      { key: "firstTouch", label: "First touch", sort: "firstTouch" },
      { key: "next", label: "Next follow-up", sort: "next" },
      { key: "followUp", label: "Follow-up", className: "px-2" },
      { key: "comment", label: "Comment", sort: "comment" },
    ],
  },
  {
    label: "Requirement",
    columns: [
      { key: "budget", label: "Budget", sort: "budget" },
      { key: "size", label: "Size", sort: "size" },
    ],
  },
  {
    label: "Origin",
    columns: [
      { key: "source", label: "Source", sort: "source" },
      { key: "inbound", label: "Inbound", sort: "inbound" },
      { key: "externalId", label: "External ID", sort: "externalId" },
    ],
  },
  {
    label: "Record",
    columns: [
      { key: "agent", label: "Agent", sort: "owner" },
      { key: "created", label: "Created", sort: "createdAt" },
      { key: "modified", label: "Modified", sort: "modified" },
    ],
  },
];
/** First column of each later group: a line marks where the group starts. */
const GROUP_STARTS = new Set(GROUPS.slice(1).map((g) => g.columns[0].key));

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
  /** Server time the rows were loaded (keeps "new"/overdue stable between server and client). */
  now: number;
  emptyMessage?: string;
  /** The column the unsorted list is ordered by, or null when it has its own order (Regenerated). */
  defaultSort?: SortColumn | null;
}) {
  const sortDir = (key?: SortColumn) =>
    key && (params.sort ?? defaultSort) === key ? (params.dir === "asc" ? "ascending" : "descending") : undefined;
  const groups: typeof GROUPS = showOriginal
    ? GROUPS.map((g, i) => (i === 0 ? { ...g, columns: [...g.columns.slice(0, 3), { key: "original", label: "Original" }, ...g.columns.slice(3)] } : g))
    : GROUPS;
  const columns = groups.flatMap((g) => g.columns);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-hairline">
      <div className="relative max-h-[540px] overflow-auto">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-100">
            <tr className="text-[10px] font-black tracking-[0.1em] text-brand uppercase">
              {groups.map((g, i) => (
                <th key={g.label} scope="colgroup" colSpan={g.columns.length} className={cn("px-3 pt-2.5 pb-0.5 whitespace-nowrap", i > 0 && "border-l border-zinc-200")}>
                  {g.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
              {columns.map((c) => (
                <th key={c.key} scope="col" aria-sort={sortDir(c.sort)} className={cn("px-3 py-3 whitespace-nowrap", GROUP_STARTS.has(c.key) && "border-l border-zinc-200", c.className)}>
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
                    {now - new Date(r.createdAt).getTime() < NEW_LEAD_HOURS * 3_600_000 ? (
                      <span role="img" aria-label="New: added in the last 24 hours" title="New: added in the last 24 hours" className="ml-1">
                        🔥
                      </span>
                    ) : null}
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
                    <LeadContact phone={r.phone} email={r.email} name={r.name} tel={telHref(r.phoneCountryCode, r.phoneNumber)} />
                  </td>
                  <td className="px-3 py-2.5 text-zinc-700">{r.cityName ?? "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.gender ?? "—"}</td>
                  <td className="border-l border-zinc-100 px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.projectName}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex flex-wrap items-center gap-1">
                      <StagePill stage={r.stage} />
                      <VerificationBadge status={r.verification} />
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-800">
                    {r.priority === "none" ? <span className="text-zinc-400">—</span> : PRIORITY_LABELS[r.priority]}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.lostReasonName ?? "—"}</td>
                  <td className="border-l border-zinc-100 px-3 py-2.5 whitespace-nowrap text-zinc-900">{r.firstTouchAt ? formatDateTime(r.firstTouchAt) : "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={cn(overdue ? "font-semibold text-rose-600" : "text-zinc-900")}>
                      {formatDateTime(r.nextFollowUpAt)}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <FollowUpButtons
                      leadId={r.id}
                      leadName={r.name}
                      hasPending={Boolean(r.nextFollowUpAt)}
                      disabled={!canEdit || closed}
                    />
                  </td>
                  <td className="max-w-[208px] px-3 py-2.5">
                    <p className="line-clamp-2 text-zinc-700">{r.latestComment ?? "—"}</p>
                  </td>
                  <td className="border-l border-zinc-100 px-3 py-2.5 whitespace-nowrap text-zinc-800 uppercase">{r.budgetName ?? "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-800">{r.desiredSize ?? "—"}</td>
                  <td className="border-l border-zinc-100 px-3 py-2.5">
                    <SourcePill>{r.sourceName ?? INBOUND_LABELS[r.inboundChannel]}</SourcePill>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{INBOUND_LABELS[r.inboundChannel]}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{r.externalId ?? "—"}</td>
                  <td className="border-l border-zinc-100 px-3 py-2.5 whitespace-nowrap text-zinc-800">{r.ownerName ?? "Unassigned"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-600">{formatDateTime(r.createdAt)}</td>
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
