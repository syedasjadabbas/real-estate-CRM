import { ArrowLeft, BookText, CalendarPlus, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BookingsMiniList } from "@/features/bookings/components/bookings-table";
import { LeadClientPanel } from "@/features/clients/components/lead-client-panel";
import { SourcePill, StagePill } from "@/features/leads/components/chips";
import {
  AssignPanel,
  EditDetailsForm,
  FollowUpsPanel,
  NotePanel,
  PanelCard,
  ReviewsPanel,
  StagePanel,
} from "@/features/leads/components/detail-panels";
import { withLeadsAccess } from "@/features/leads/components/list-view";
import { FavoriteButton } from "@/features/leads/components/row-actions";
import { Timeline } from "@/features/leads/components/timeline";
import { formatDateTime, formatDuration } from "@/features/leads/format";
import { canDoBooking } from "@/modules/bookings/policy";
import { bookingsFor } from "@/modules/bookings/queries";
import { LeadMeetingsList } from "@/features/meetings/components/lead-meetings";
import { canDoMeeting } from "@/modules/meetings/policy";
import { meetingsForLead } from "@/modules/meetings/queries";
import { clientStatusForLead } from "@/modules/clients/queries";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { RecordingsPanel } from "@/features/recordings/components/recordings-panel";
import { listDocuments } from "@/modules/documents/service";
import { INBOUND_LABELS } from "@/modules/leads/constants";
import { telHref } from "@/modules/leads/phone";
import { listRecordings } from "@/modules/recordings/service";
import { Dialer } from "@/features/voip/components/dialer";
import { getVoipStatus } from "@/modules/voip/service";
import { assignableUsers, getLeadDetail, leadLookups } from "@/modules/leads/queries";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Lead" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</p>
      <div className="mt-0.5 truncate text-sm font-bold">{children}</div>
    </div>
  );
}

export default function LeadDetailPage({ params }: PageProps<"/dashboard/leads/[id]">) {
  return withLeadsAccess(async ({ actor, db }) => {
    const { id } = await params;
    let detail;
    try {
      detail = await getLeadDetail(db, actor, id);
    } catch (error) {
      if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
      throw error;
    }
    const { lead } = detail;
    const [lookups, owners, clientStatus, leadBookings, leadMeetings, recordings, documents] = await Promise.all([
      leadLookups(db),
      assignableUsers(db, actor),
      clientStatusForLead(db, actor, lead),
      bookingsFor(db, actor, { leadId: lead.id }),
      meetingsForLead(db, actor, lead.id),
      listRecordings(db, actor, lead.id),
      listDocuments(db, actor, lead.id),
    ]);

    return (
      <section className="space-y-6" aria-label={lead.name}>
        <PageHeader
          as="h2"
          title={lead.name}
          description={`Owner ${lead.ownerName ?? "Unassigned"} · ${lead.projectName}`}
          actions={
            <>
              <a href={telHref(lead.phoneCountryCode, lead.phoneNumber)} className={buttonClasses({ variant: "primary", size: "lg" })} aria-label={`Call ${lead.name} on ${lead.phone}`}>
                <Phone aria-hidden="true" className="size-4" />
                Call
              </a>
              <FavoriteButton leadId={lead.id} initial={lead.isFavorite} size="md" />
              <Link href="/dashboard/leads" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                <ArrowLeft aria-hidden="true" className="size-4" />
                Back to list
              </Link>
            </>
          }
        />

        <Card className="p-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            <Fact label="Code">
              <span className="tracking-[0.05em]">{lead.code}</span>
            </Fact>
            <Fact label="Phone">
              <a href={telHref(lead.phoneCountryCode, lead.phoneNumber)} className="hover:text-brand hover:underline">
                {lead.phone}
              </a>
            </Fact>
            <Fact label="Lead">
              <StagePill stage={lead.stage} />
            </Fact>
            <Fact label="Inbound">
              <SourcePill>{INBOUND_LABELS[lead.inboundChannel]}</SourcePill>
            </Fact>
            <Fact label="First added">{formatDateTime(lead.createdAt)}</Fact>
            <Fact label="Time to first touch">{formatDuration(lead.timeToFirstTouchMs)}</Fact>
          </div>
          {lead.stage === "lost_lead" && lead.lostReason ? (
            <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">Lost reason: {lead.lostReason}</p>
          ) : null}
          {lead.originalCode ? (
            <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Flagged as a duplicate of lead {lead.originalCode}.
            </p>
          ) : null}
        </Card>

        <Dialer status={getVoipStatus(actor)} telHref={telHref(lead.phoneCountryCode, lead.phoneNumber)} leadName={lead.name} phone={lead.phone} />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-6">
            <EditDetailsForm detail={detail} lookups={lookups} />
            <Timeline activities={detail.activities} />
          </div>
          <div className="space-y-6">
            <StagePanel detail={detail} lostReasons={lookups.lostReasons} />
            {detail.permissions.assign ? <AssignPanel leadId={lead.id} ownerId={lead.ownerId} owners={owners} /> : null}
            <FollowUpsPanel detail={detail} />
            <NotePanel leadId={lead.id} canEdit={detail.permissions.edit} />
            <RecordingsPanel leadId={lead.id} recordings={recordings} canUpload={detail.permissions.edit} canDelete={actor.role === "super_admin"} />
            <DocumentsPanel leadId={lead.id} documents={documents} canUpload={detail.permissions.edit} />
            <ReviewsPanel detail={detail} />
            {clientStatus ? <LeadClientPanel leadId={lead.id} status={clientStatus} /> : null}
            {canDoBooking(actor, "view") ? (
              <PanelCard title="Bookings">
                <BookingsMiniList rows={leadBookings} empty="No bookings for this lead yet." />
                {canDoBooking(actor, "create") && lead.stage !== "lost_lead" && lead.stage !== "booked" ? (
                  <Link
                    href={`/dashboard/bookings/new?project=${lead.projectId}&lead=${lead.id}`}
                    className={buttonClasses({ variant: "secondary", size: "lg", className: "mt-3" })}
                  >
                    <BookText aria-hidden="true" className="size-4" />
                    Start booking →
                  </Link>
                ) : null}
              </PanelCard>
            ) : null}
            {canDoMeeting(actor, "view") ? (
              <PanelCard title="Meetings">
                <LeadMeetingsList rows={leadMeetings} />
                {canDoMeeting(actor, "create") ? (
                  <Link href={`/dashboard/meetings/new?lead=${lead.id}`} className={buttonClasses({ variant: "secondary", size: "lg", className: "mt-3" })}>
                    <CalendarPlus aria-hidden="true" className="size-4" />
                    Schedule meeting →
                  </Link>
                ) : null}
              </PanelCard>
            ) : null}
          </div>
        </div>
      </section>
    );
  });
}
