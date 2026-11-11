import { ArrowLeft, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { StagePill } from "@/features/leads/components/chips";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { MeetingStatusPill } from "@/features/meetings/components/meeting-pills";
import { MeetingStatusPanel } from "@/features/meetings/components/meeting-status-panel";
import { OverdueChip } from "@/features/tasks/components/task-pills";
import { canDoMeeting } from "@/modules/meetings/policy";
import { getMeetingDetail, type MeetingDetail } from "@/modules/meetings/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { MEETING_TYPE_LABELS } from "@/modules/meetings/constants";

export const metadata: Metadata = { title: "Meeting" };

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  startsAt: "start",
  endsAt: "end",
  type: "type",
  location: "location",
  organizerId: "organizer",
  leadId: "lead",
  notes: "notes",
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</p>
      <div className="mt-0.5 text-sm font-bold break-words">{children}</div>
    </div>
  );
}

function historyText(h: MeetingDetail["history"][number], names: Record<string, string>) {
  const d = (h.data ?? {}) as Record<string, unknown>;
  const note = d.note ? ` · ${String(d.note)}` : "";
  switch (h.action) {
    case "create":
      return `Scheduled for ${formatDateTime(String(d.startsAt))}${d.movedLead ? " · lead moved to Meeting Scheduled" : ""}`;
    case "update":
      return `Updated ${Object.keys(d).map((k) => FIELD_LABELS[k] ?? k).join(", ")}`;
    case "organizer":
      return `Organizer: ${names[d.from as string] ?? "—"} → ${names[d.to as string] ?? "—"}`;
    case "complete":
      return `Completed${d.movedLead ? " · lead moved to Meeting Done" : ""}${note}`;
    case "cancel":
      return `Cancelled${note}`;
    default:
      return h.action;
  }
}

export default async function MeetingDetailPage({ params, searchParams }: PageProps<"/dashboard/meetings/[id]">) {
  const actor = await requirePageUser();
  if (!canDoMeeting(actor, "view")) return <RestrictedState />;
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  let detail: MeetingDetail;
  try {
    detail = await getMeetingDetail(getDb(), actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { meeting, lead } = detail;
  const editable = detail.canEdit && meeting.status === "scheduled" && lead !== null;

  return (
    <section className="space-y-6" aria-label="Meeting">
      <PageHeader
        as="h2"
        title={<span className="break-words">{meeting.title}</span>}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <MeetingStatusPill status={meeting.status} />
            {detail.overdue ? <OverdueChip /> : null}
          </span>
        }
        actions={
          <>
            <Link href="/dashboard/meetings" className={buttonClasses({ variant: "secondary", size: "lg" })}>
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to list
            </Link>
            {editable ? (
              <Link href={`/dashboard/meetings/${meeting.id}/edit`} className={buttonClasses({ variant: "primary", size: "lg", className: "px-5" })}>
                <Pencil aria-hidden="true" className="size-4" />
                Edit
              </Link>
            ) : null}
          </>
        }
      />
      {saved ? (
        <p role="status" className="rounded-2xl border border-brand/30 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700">
          Meeting saved.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <PanelCard title="Details">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Starts">
                <span className={detail.overdue ? "text-rose-600" : undefined}>{formatDateTime(meeting.startsAt)}</span>
              </Fact>
              <Fact label="Ends">{meeting.endsAt ? formatDateTime(meeting.endsAt) : "—"}</Fact>
              <Fact label="Type">{meeting.type ? MEETING_TYPE_LABELS[meeting.type] : "—"}</Fact>
              <Fact label="Location">{meeting.location ?? "—"}</Fact>
              <Fact label="Organizer">{detail.organizerName ?? "—"}</Fact>
              <Fact label="Created by">{detail.creatorName ?? "—"}</Fact>
              <Fact label="Updated">{formatDateTime(meeting.updatedAt)}</Fact>
              <Fact label="Lead">
                {lead ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/dashboard/leads/${lead.id}`} className="text-brand hover:underline">
                      {lead.name} ({lead.code})
                    </Link>
                    <StagePill stage={lead.stage} />
                  </span>
                ) : (
                  <span className="text-zinc-500">Linked (outside your access)</span>
                )}
              </Fact>
            </div>
            <div className="mt-4 border-t border-zinc-100 pt-4">
              <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">Notes</p>
              <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-800">{meeting.notes || "No notes."}</p>
            </div>
          </PanelCard>

          <PanelCard title="History">
            {detail.history.length === 0 ? (
              <EmptyState size="sm">No history yet.</EmptyState>
            ) : (
              <ol className="space-y-2">
                {detail.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 pb-2 text-xs last:border-b-0 last:pb-0">
                    <span className="min-w-0 font-semibold break-words text-zinc-800">{historyText(h, detail.userNames)}</span>
                    <span className="text-[11px] text-zinc-500">
                      {h.actorName ?? "System"} · {formatDateTime(h.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </PanelCard>
        </div>
        <div className="min-w-0 space-y-6">
          <MeetingStatusPanel meetingId={meeting.id} status={meeting.status} leadStage={lead?.stage ?? null} canEdit={detail.canEdit} />
        </div>
      </div>
    </section>
  );
}
