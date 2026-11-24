import { ArrowLeft, BookText, CalendarPlus, Phone, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BookingsMiniList } from "@/features/bookings/components/bookings-table";
import { LeadClientPanel } from "@/features/clients/components/lead-client-panel";
import { StagePill } from "@/features/leads/components/chips";
import {
  AssignPanel,
  EditDetailsForm,
  FollowUpsPanel,
  NotePanel,
  PanelCard,
  ReviewsPanel,
  StagePanel,
} from "@/features/leads/components/detail-panels";
import { VerificationBanner } from "@/features/leads/components/verification";
import { LogActivityForm } from "@/features/leads/components/log-activity-form";
import { withLeadsAccess } from "@/features/leads/components/list-view";
import { EnquiryList, RecordEnquiryForm } from "@/features/leads/components/enquiry-history";
import { ReopenLead } from "@/features/leads/components/reopen-lead";
import { FavoriteButton } from "@/features/leads/components/row-actions";
import { Timeline } from "@/features/leads/components/timeline";
import { canDoBooking } from "@/modules/bookings/policy";
import { bookingsFor } from "@/modules/bookings/queries";
import { LeadMeetingsList } from "@/features/meetings/components/lead-meetings";
import { canDoMeeting } from "@/modules/meetings/policy";
import { canViewAuditLog } from "@/modules/audit/service";
import { openMeetings } from "@/modules/meetings/open";
import { meetingsForLead } from "@/modules/meetings/queries";
import { clientStatusForLead } from "@/modules/clients/queries";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { RecordingsPanel } from "@/features/recordings/components/recordings-panel";
import { listDocuments } from "@/modules/documents/service";
import { telHref } from "@/modules/leads/phone";
import { canPlayRecordings, listRecordings } from "@/modules/recordings/service";
import { Dialer } from "@/features/voip/components/dialer";
import { getVoipStatus } from "@/modules/voip/service";
import { assignableUsers, getLeadDetail, leadLookups } from "@/modules/leads/queries";
import { AppError } from "@/server/errors";
import { MaskedPhone } from "@/components/ui/masked-phone";
import { EmailWithGmail } from "@/components/ui/gmail-button";
import { WhatsappPanel } from "@/features/whatsapp/components/whatsapp-panel";
import { listWhatsapp } from "@/modules/whatsapp/service";

export const metadata: Metadata = { title: "Lead" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</p>
      <div className="mt-0.5 truncate text-sm font-bold">{children}</div>
    </div>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-24 border-b border-zinc-200 pb-2 text-base font-black tracking-[-0.01em]">
      {children}
    </h3>
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
    // "Log activity" replaces the separate stage, note and schedule-follow-up forms (14 Nov 2026).
    const callCard = detail.permissions.edit && detail.permissions.scheduleFollowUp;
    const [lookups, owners, clientStatus, leadBookings, leadMeetings, recordings, documents, whatsapp, scheduled] = await Promise.all([
      leadLookups(db),
      assignableUsers(db, actor),
      clientStatusForLead(db, actor, lead),
      bookingsFor(db, actor, { leadId: lead.id }),
      meetingsForLead(db, actor, lead.id),
      listRecordings(db, actor, lead.id),
      listDocuments(db, actor, lead.id),
      listWhatsapp(db, actor, lead.id),
      openMeetings(db, actor, [lead.id]),
    ]);

    return (
      <section className="space-y-6" aria-label={lead.name}>
        <PageHeader
          as="h2"
          title={lead.name}
          description={`Owner ${lead.ownerName ?? "Unassigned"} · ${lead.projectName}`}
          actions={
            <>
              <a href={telHref(lead.phoneCountryCode, lead.phoneNumber)} className={buttonClasses({ variant: "primary", size: "lg" })} aria-label={`Call ${lead.name}`}>
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

        <VerificationBanner leadId={lead.id} verification={detail.verification} canVerify={detail.permissions.verify} canResubmit={detail.permissions.resubmit} />

        <Card className="p-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label="Code">
              <span className="tracking-[0.05em]">{lead.code}</span>
            </Fact>
            <Fact label="Phone">
              <MaskedPhone phone={lead.phone} name={lead.name} />
            </Fact>
            <Fact label="Email">
              <EmailWithGmail email={lead.email} name={lead.name} />
            </Fact>
            <Fact label="Stage">
              <StagePill stage={lead.stage} />
            </Fact>
          </div>
          {lead.stage === "lost_lead" ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-50 px-3 py-2">
              <p className="text-xs font-semibold text-rose-700">{lead.lostReason ? `Lost reason: ${lead.lostReason}` : "This lead is lost."}</p>
              {detail.permissions.edit ? <ReopenLead leadId={lead.id} leadName={lead.name} lastStage={detail.stageBeforeLost} /> : null}
            </div>
          ) : null}
          {lead.originalCode ? (
            <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Flagged as a duplicate of lead {lead.originalCode}.
            </p>
          ) : null}
        </Card>

        {/* The client's five sections (23 Nov 2026): the form holds the first three. */}
        <nav aria-label="Lead sections" className="flex gap-1.5 overflow-x-auto rounded-2xl border border-zinc-200/80 bg-white p-1.5 shadow-hairline">
          {[
            ["customer", "Customer information"],
            ["requirements", "Property requirements"],
            ["lead-information", "Lead information"],
            ["sales-activity", "Sales activity"],
            ["booking-information", "Booking information"],
          ].map(([anchor, label]) => (
            <a key={anchor} href={`#${anchor}`} className="shrink-0 rounded-xl px-3.5 py-2 text-xs leading-4 font-bold whitespace-nowrap text-zinc-700 hover:bg-zinc-100">
              {label}
            </a>
          ))}
        </nav>

        {/* One save for what happened and what it decided (owner, 14 Nov 2026; client, 24 Nov 2026). */}
        {callCard ? <LogActivityForm leadId={lead.id} meetings={scheduled.get(lead.id) ?? []} currentStage={lead.stage} pendingFollowUps={detail.followUps.filter((f) => f.status === "pending")} /> : null}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0">
            <EditDetailsForm detail={detail} lookups={lookups} />
          </div>
          <div className="space-y-6">
            {clientStatus ? <LeadClientPanel leadId={lead.id} status={clientStatus} /> : null}
            {detail.permissions.assign ? <AssignPanel leadId={lead.id} ownerId={lead.ownerId} owners={owners} /> : null}
            <StagePanel detail={detail} lostReasons={lookups.lostReasons} showStage={!callCard && lead.stage !== "lost_lead"} />
            <DocumentsPanel leadId={lead.id} documents={documents} canUpload={detail.permissions.edit} />
          </div>
        </div>

        <SectionTitle id="sales-activity">Sales activity</SectionTitle>
        <Dialer status={getVoipStatus(actor)} telHref={telHref(lead.phoneCountryCode, lead.phoneNumber)} leadName={lead.name} phone={lead.phone} />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-6">
            {canViewAuditLog(actor) ? (
              <div className="flex justify-end">
                <Link href={`/dashboard/settings/audit-log?lead=${encodeURIComponent(lead.code)}`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
                  <ScrollText aria-hidden="true" className="size-4" />
                  Open full audit
                </Link>
              </div>
            ) : null}
            <Timeline activities={detail.activities} people={detail.activityPeople} asOf={detail.asOf} />
          </div>
          <div className="space-y-6">
            <PanelCard title={`Enquiry history · ${lead.enquiries.length}`}>
              {detail.permissions.recordEnquiry ? <RecordEnquiryForm leadId={lead.id} sources={lookups.sources} /> : null}
              <EnquiryList rows={lead.enquiries} />
            </PanelCard>
            <FollowUpsPanel detail={detail} canSchedule={!callCard} />
            {canDoMeeting(actor, "view") ? (
              <PanelCard title="Meetings">
                <LeadMeetingsList rows={leadMeetings} />
                {canDoMeeting(actor, "create") && detail.permissions.edit ? (
                  <Link href={`/dashboard/meetings/new?lead=${lead.id}`} className={buttonClasses({ variant: "secondary", size: "lg", className: "mt-3" })}>
                    <CalendarPlus aria-hidden="true" className="size-4" />
                    Schedule meeting →
                  </Link>
                ) : null}
              </PanelCard>
            ) : null}
            {callCard ? null : <NotePanel leadId={lead.id} canEdit={detail.permissions.edit} />}
            <RecordingsPanel leadId={lead.id} recordings={recordings} canUpload={detail.permissions.edit} canDelete={actor.role === "super_admin"} canPlay={canPlayRecordings(actor)} />
            <WhatsappPanel
              leadId={lead.id}
              rows={whatsapp.map((w) => ({ id: w.id, kind: w.kind, name: w.name, durationSec: w.durationSec, createdAt: w.createdAt.toISOString(), uploadedBy: w.uploadedBy }))}
              canUpload={detail.permissions.edit}
            />
            <ReviewsPanel detail={detail} recordings={recordings} />
          </div>
        </div>

        {canDoBooking(actor, "view") ? <SectionTitle id="booking-information">Booking information</SectionTitle> : null}
            {canDoBooking(actor, "view") ? (
              <PanelCard title="Bookings">
                <BookingsMiniList rows={leadBookings} empty="No bookings for this lead yet." />
                {canDoBooking(actor, "create") && detail.permissions.edit && lead.stage !== "lost_lead" && lead.stage !== "booked" ? (
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
      </section>
    );
  });
}
