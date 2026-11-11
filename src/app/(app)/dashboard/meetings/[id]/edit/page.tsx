import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { toLocalInputValue } from "@/features/leads/format";
import { MeetingForm } from "@/features/meetings/components/meeting-form";
import { MEETING_STATUS_LABELS } from "@/modules/meetings/constants";
import { canDoMeeting } from "@/modules/meetings/policy";
import { getMeetingDetail, meetingFormOptions, type MeetingDetail } from "@/modules/meetings/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getProjectScope } from "@/server/project-scope";

export const metadata: Metadata = { title: "Edit meeting" };

export default async function EditMeetingPage({ params }: PageProps<"/dashboard/meetings/[id]/edit">) {
  const actor = await requirePageUser();
  if (!canDoMeeting(actor, "edit")) return <RestrictedState />;
  const { id } = await params;
  let detail: MeetingDetail;
  try {
    detail = await getMeetingDetail(getDb(), actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { meeting } = detail;
  const back = (
    <Link href={`/dashboard/meetings/${meeting.id}`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to meeting
    </Link>
  );
  if (meeting.status !== "scheduled" || !detail.lead) {
    return (
      <section className="space-y-6" aria-label="Edit meeting">
        <PageHeader as="h2" title="Edit meeting" actions={back} />
        <EmptyState className="bg-white">
          {meeting.status !== "scheduled"
            ? `This meeting is ${MEETING_STATUS_LABELS[meeting.status].toLowerCase()} and can't be edited.`
            : "The linked lead is outside your access, so this meeting can only be edited by someone who can open the lead."}
        </EmptyState>
      </section>
    );
  }
  const { activeProjectId } = await getProjectScope();
  const options = await meetingFormOptions(getDb(), actor, activeProjectId, meeting.leadId);
  if (!options.organizers.some((o) => o.id === meeting.organizerId)) {
    options.organizers.unshift({ id: meeting.organizerId, name: detail.organizerName ?? "Current organizer" });
  }

  return (
    <section className="space-y-6" aria-label="Edit meeting">
      <PageHeader as="h2" title="Edit meeting" description={meeting.title} actions={back} />
      <MeetingForm
        mode="edit"
        meetingId={meeting.id}
        options={options}
        initial={{
          title: meeting.title,
          startsLocal: toLocalInputValue(meeting.startsAt),
          endsLocal: meeting.endsAt ? toLocalInputValue(meeting.endsAt) : "",
          type: meeting.type ?? "",
          location: meeting.location ?? "",
          organizerId: meeting.organizerId,
          leadId: meeting.leadId,
          notes: meeting.notes ?? "",
        }}
      />
    </section>
  );
}
