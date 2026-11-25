import { NEW_LEAD_HOURS } from "@/modules/leads/constants";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { INBOUND_LABELS, PRIORITY_LABELS, type SortColumn } from "@/modules/leads/constants";
import { telHref } from "@/modules/leads/phone";
import type { LeadListRow } from "@/modules/leads/queries";
import { formatSqft, PROPERTY_TYPE_LABELS, type PropertyType } from "@/modules/leads/size";
import { followUpStatus, formatDate, formatDateTime, noContactLabel, since, type FollowUpStatus } from "../format";
import { withParams } from "../url";
import { MEETING_TYPE_LABELS, type MeetingType } from "@/modules/meetings/constants";
import { SourcePill, StagePill } from "./chips";
import { ViewContact } from "./lead-contact";
import { LogActivityButton } from "./log-activity-button";
import { OtherProjects } from "./other-projects";
import { VerificationBadge } from "./verification";
import { FavoriteButton } from "./row-actions";

type Column = { key: string; label: string; sort?: SortColumn; className?: string };

/**
 * The agent's working table (client, 23 Nov 2026): who to contact, where they stand, what comes next.
 * Everything else is behind "More columns", and on the lead page.
 */
const MAIN: Column[] = [
  { key: "star", label: "★", className: "w-10 px-2" },
  { key: "lead", label: "Lead", sort: "name" },
  { key: "project", label: "Project", sort: "project" },
  { key: "stage", label: "Stage", sort: "stage" },
  { key: "inStage", label: "Time in stage", sort: "inStage" },
  { key: "priority", label: "Priority", sort: "priority" },
  { key: "lastContact", label: "Last contact", sort: "lastContact" },
  { key: "next", label: "Next follow-up", sort: "next" },
];
/** Meetings scheduled: when, what kind and where (client, 25 Nov 2026). */
const MEETING: Column = { key: "meeting", label: "Meeting" };
/** Repeat enquiries: why they asked again. */
const REASON: Column = { key: "reason", label: "Reason" };
const ACTIONS: Column = { key: "actions", label: "Actions" };
const AGENT: Column = { key: "agent", label: "Agent", sort: "owner" };
const MORE: Column[] = [
  { key: "city", label: "City", sort: "city" },
  { key: "source", label: "Source", sort: "source" },
  { key: "inbound", label: "Inbound", sort: "inbound" },
  { key: "budget", label: "Budget", sort: "budget" },
  { key: "size", label: "Size", sort: "size" },
  { key: "firstTouch", label: "First touch", sort: "firstTouch" },
  { key: "comment", label: "Comment", sort: "comment" },
  { key: "lostReason", label: "Lost reason", sort: "lostReason" },
];
/** Technical and audit details: Admins only (client, 23 Nov 2026). */
const ADMIN_MORE: Column[] = [
  { key: "externalId", label: "External ID", sort: "externalId" },
  { key: "created", label: "Created", sort: "createdAt" },
  { key: "modified", label: "Modified", sort: "modified" },
];

const FOLLOW_UP_TONES: Record<FollowUpStatus, string> = {
  Overdue: "bg-rose-100 text-rose-700",
  "Due today": "bg-amber-100 text-amber-800",
  Upcoming: "bg-zinc-100 text-zinc-600",
};

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

export function LeadsTable({
  rows,
  pathname,
  params,
  showOriginal = false,
  showAgent = false,
  showMeeting = false,
  showReason = false,
  canEdit,
  now,
  emptyMessage = "No leads match these filters.",
  defaultSort = "createdAt",
}: {
  rows: LeadListRow[];
  pathname: string;
  params: Record<string, string>;
  showOriginal?: boolean;
  showMeeting?: boolean;
  showReason?: boolean;
  /** Admins see whose lead it is; an agent's list is all their own. */
  showAgent?: boolean;
  canEdit: boolean;
  /** Server time the rows were loaded (keeps "new"/overdue stable between server and client). */
  now: number;
  emptyMessage?: string;
  /** The column the unsorted list is ordered by, or null when it has its own order (Regenerated). */
  defaultSort?: SortColumn | null;
}) {
  const sortDir = (key?: SortColumn) =>
    key && (params.sort ?? defaultSort) === key ? (params.dir === "asc" ? "ascending" : "descending") : undefined;
  const all = params.columns === "all";
  const columns = [
    ...MAIN.slice(0, 2),
    ...(showOriginal ? [{ key: "original", label: "Original" }] : []),
    ...MAIN.slice(2),
    ...(showMeeting ? [MEETING] : []),
    ...(showReason ? [REASON] : []),
    ...(showAgent ? [AGENT] : []),
    ACTIONS,
    ...(all ? MORE : []),
    ...(all && showAgent ? ADMIN_MORE : []),
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-hairline">
      <div className="flex justify-end border-b border-zinc-100 px-3 py-2">
        <Link
          href={withParams(pathname, params, { columns: all ? null : "all" })}
          className="rounded-lg border border-zinc-200/80 px-2.5 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-50"
        >
          {all ? "Fewer columns" : "More columns"}
        </Link>
      </div>
      <div className="relative max-h-[540px] overflow-auto">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-100">
            <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
              {columns.map((c) => (
                <th key={c.key} scope="col" aria-sort={sortDir(c.sort)} className={cn("px-2 py-3.5 whitespace-nowrap", c.className, c.key === "actions" && "sticky right-0 border-l border-zinc-200 bg-zinc-100")}>
                  <SortHeader column={c} pathname={pathname} params={params} defaultSort={defaultSort} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const closed = r.stage === "lost_lead" || r.stage === "booked";
              const text = (key: string, value: ReactNode, className = "whitespace-nowrap text-zinc-700") => (
                <td key={key} className={cn("px-2 py-2.5", className)}>
                  {value ?? "—"}
                </td>
              );
              const badge = "mt-1 block w-fit rounded-full px-2 py-0.5 text-[9px] font-black tracking-[0.05em] uppercase";
              const cells: Record<string, ReactNode> = {
                star: (
                  <td key="star" className="px-2 py-2.5">
                    <FavoriteButton leadId={r.id} initial={r.isFavorite} />
                  </td>
                ),
                lead: (
                  <td key="lead" className="px-2 py-2.5">
                    <Link href={`/dashboard/leads/${r.id}`} className="text-[13px] font-bold hover:text-brand hover:underline">
                      {r.name}
                    </Link>
                    {now - new Date(r.createdAt).getTime() < NEW_LEAD_HOURS * 3_600_000 ? (
                      <span role="img" aria-label="New: added in the last 24 hours" title="New: added in the last 24 hours" className="ml-1">
                        🔥
                      </span>
                    ) : null}
                    <span className="block text-[11px] font-bold tracking-[0.05em] text-zinc-500">{r.code}</span>
                    <ViewContact phone={r.phone} email={r.email} name={r.name} code={r.code} tel={telHref(r.phoneCountryCode, r.phoneNumber)} />
                    {r.isRegenerated ? <span className={cn(badge, "bg-sky-50 text-sky-700")}>Repeat enquiry{r.regeneratedAt ? ` · ${formatDate(r.regeneratedAt)}` : ""}</span> : null}
                    {r.duplicateOfId ? <span className={cn(badge, "bg-amber-50 text-amber-800")}>Duplicate</span> : null}
                  </td>
                ),
                original: text("original", r.originalCode, "font-bold tracking-[0.05em] text-zinc-700"),
                project: text(
                  "project",
                  <>
                    <span className="block">{r.projectName}</span>
                    {r.otherProjects.length ? <OtherProjects names={r.otherProjects} customer={r.name} /> : null}
                  </>,
                ),
                stage: text(
                  "stage",
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <StagePill stage={r.stage} />
                    <VerificationBadge status={r.verification} />
                    {r.wrongNumberAt ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black tracking-[0.04em] text-amber-800 uppercase">Number being checked</span> : null}
                  </span>,
                ),
                inStage: text("inStage", since(r.stageChangedAt, now), "whitespace-nowrap font-semibold text-zinc-900"),
                priority: text("priority", r.priority === "none" ? null : PRIORITY_LABELS[r.priority], "text-zinc-800"),
                lastContact: text(
                  "lastContact",
                  r.lastContactAt ? (
                    <>
                      <span className="block font-semibold text-zinc-900">{since(r.lastContactAt, now)} ago</span>
                      <span className="block text-[11px] text-zinc-600">{formatDateTime(r.lastContactAt)}</span>
                    </>
                  ) : (
                    <span className="font-semibold text-amber-700">{noContactLabel(r.stage)}</span>
                  ),
                ),
                next: text(
                  "next",
                  r.nextFollowUpAt && !closed ? (
                    <>
                      <span className={cn("block w-fit rounded-full px-2 py-0.5 text-[10px] leading-4 font-black tracking-[0.04em] uppercase", FOLLOW_UP_TONES[followUpStatus(r.nextFollowUpAt, now)])}>
                        {followUpStatus(r.nextFollowUpAt, now)}
                      </span>
                      <span className="mt-1 block text-zinc-800">{formatDateTime(r.nextFollowUpAt)}</span>
                    </>
                  ) : null,
                ),
                agent: text("agent", r.ownerName ?? "Unassigned", "whitespace-nowrap text-zinc-800"),
                actions: (
                  <td key="actions" className="sticky right-0 border-l border-zinc-100 bg-white px-2 py-2.5">
                    <div className="flex w-fit flex-col gap-1.5">
                      {/* An agent works a lead only once it is verified (the server refuses it before), so no logging until then. */}
                      {canEdit && !closed && (showAgent || (r.verification === "approved" && !r.wrongNumberAt)) ? (
                        <LogActivityButton leadId={r.id} leadName={r.name} stage={r.stage} pendingFollowUps={r.pendingFollowUps} meetings={r.openMeetings} />
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </div>
                  </td>
                ),
                meeting: text(
                  "meeting",
                  r.openMeetings.length ? (
                    <ul className="space-y-1">
                      {r.openMeetings.slice(0, 3).map((m) => (
                        <li key={m.id}>
                          <Link href={`/dashboard/meetings/${m.id}`} className="font-bold text-zinc-900 hover:text-brand hover:underline">
                            {formatDateTime(m.startsAt)}
                          </Link>
                          <span className="block text-[11px] text-zinc-600">
                            {[m.type ? MEETING_TYPE_LABELS[m.type as MeetingType] : null, m.location ?? "No location"].filter(Boolean).join(" · ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null,
                ),
                reason: text(
                  "reason",
                  <>
                    <span className="block font-semibold text-zinc-900">{r.repeat?.reason ?? "Not recorded"}</span>
                    {r.repeat?.channel ? <span className="block text-[11px] text-zinc-500">{r.repeat.channel}</span> : null}
                  </>,
                  "max-w-[220px] text-zinc-700",
                ),
                city: text("city", r.cityName),
                source: text(
                  "source",
                  <>
                    <SourcePill>{r.sourceName ?? INBOUND_LABELS[r.inboundChannel]}</SourcePill>
                    {r.campaign ? <span className="mt-1 block text-[11px] text-zinc-500">{r.campaign}</span> : null}
                  </>,
                ),
                inbound: text("inbound", INBOUND_LABELS[r.inboundChannel]),
                budget: text("budget", r.budgetName, "whitespace-nowrap text-zinc-800 uppercase"),
                size: text(
                  "size",
                  r.desiredSize || r.propertyType ? (
                    <>
                      <span className="block">{[r.desiredSize, r.propertyType ? PROPERTY_TYPE_LABELS[r.propertyType as PropertyType] : null].filter(Boolean).join(" · ")}</span>
                      {r.sizeSqft ? <span className="block text-[11px] text-zinc-500">{formatSqft(r.sizeSqft)}</span> : r.desiredSize ? <span className="block text-[11px] font-semibold text-amber-700">Unclear size</span> : null}
                    </>
                  ) : null,
                  "whitespace-nowrap",
                ),
                firstTouch: text("firstTouch", r.firstTouchAt ? formatDateTime(r.firstTouchAt) : null),
                comment: text("comment", r.latestComment ? <span className="line-clamp-2">{r.latestComment}</span> : null, "max-w-[208px] text-zinc-700"),
                lostReason: text("lostReason", r.lostReasonName),
                externalId: text("externalId", r.externalId),
                created: text("created", formatDateTime(r.createdAt)),
                modified: text("modified", formatDateTime(r.updatedAt)),
              };
              return (
                <tr key={r.id} className="border-b border-zinc-100/80 bg-white align-top last:border-b-0 hover:bg-zinc-50/60">
                  {columns.map((c) => cells[c.key])}
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
