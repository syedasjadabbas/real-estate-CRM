import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { BookingsMiniList } from "@/features/bookings/components/bookings-table";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { ClientTimeline, relationshipLabel } from "@/features/clients/components/client-timeline";
import { PaymentHistoryList } from "@/features/finance/components/payment-history";
import { AssignClientPanel, ClientFollowUpsPanel, ClientNotePanel, EditClientForm } from "@/features/clients/components/detail-panels";
import { clientsContext } from "@/features/clients/context";
import { StagePill } from "@/features/leads/components/chips";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { bookingsFor } from "@/modules/bookings/queries";
import { getClientDetail } from "@/modules/clients/queries";
import { listClientDocuments } from "@/modules/documents/service";
import { canSeeItemisedPayments } from "@/modules/finance/policy";
import { bookingPaymentHistory } from "@/modules/finance/queries";
import { assignableUsers, leadLookups } from "@/modules/leads/queries";
import { AppError } from "@/server/errors";

const CLIENT_DOCUMENTS = { title: "Contracts and documents", empty: "No contracts or documents yet.", field: "Upload a contract or document", button: "Upload document", uploaded: "Document uploaded.", noun: "Documents" };

export const metadata: Metadata = { title: "Client" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</p>
      <div className="mt-0.5 truncate text-sm font-bold">{children}</div>
    </div>
  );
}

export default async function ClientDetailPage({ params }: PageProps<"/dashboard/clients/[id]">) {
  const { actor, db, canView } = await clientsContext();
  if (!canView) return <RestrictedState />;
  const { id } = await params;
  let detail;
  try {
    detail = await getClientDetail(db, actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const [lookups, owners, investments, documents] = await Promise.all([
    leadLookups(db),
    detail.permissions.assign ? assignableUsers(db, actor) : [],
    bookingsFor(db, actor, { clientId: id }),
    listClientDocuments(db, actor, id),
  ]);
  const { client } = detail;
  // FR-204 per-client history across the client's bookings, for roles that may see itemised payments.
  const paymentHistory = canSeeItemisedPayments(actor)
    ? (
        await Promise.all(
          investments.map(async (b) =>
            ((await bookingPaymentHistory(db, actor, b.id)) ?? []).map((p) => ({ ...p, bookingLabel: `Unit ${b.unitNo}` })),
          ),
        )
      ).flat()
    : null;

  return (
    <section className="space-y-6" aria-label={client.name}>
      <PageHeader
        as="h2"
        title={client.name}
        description={`Owner ${client.ownerName ?? "Unassigned"} · Client since ${formatDateTime(client.createdAt)}`}
        actions={
          <Link href="/dashboard/clients" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to list
          </Link>
        }
      />

      <Card className="p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <Fact label="Phone">{client.phone}</Fact>
          <Fact label="Email">{client.email ?? "—"}</Fact>
          <Fact label="Relationship">{relationshipLabel(client.relationship)}</Fact>
          <Fact label="City">{client.cityName ?? "—"}</Fact>
          <Fact label="Linked leads">{detail.linkedLeads.length + detail.hiddenLeadCount}</Fact>
          <Fact label="Next follow-up">{formatDateTime(client.nextFollowUpAt)}</Fact>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <EditClientForm detail={detail} cities={lookups.cities} />

          <PanelCard title="Linked leads">
            {detail.linkedLeads.length === 0 ? (
              <EmptyState size="sm">No linked leads you can open.</EmptyState>
            ) : (
              <ul className="space-y-1.5">
                {detail.linkedLeads.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
                    <div className="min-w-0">
                      <Link href={`/dashboard/leads/${l.id}`} className="font-bold hover:text-brand hover:underline">
                        {l.name}
                      </Link>{" "}
                      <span className="font-bold tracking-[0.05em] text-zinc-500">{l.code}</span>
                      <p className="text-[11px] text-zinc-500">
                        {l.projectName} · {l.ownerName ?? "Unassigned"} · added {formatDateTime(l.createdAt)}
                      </p>
                    </div>
                    <StagePill stage={l.stage} />
                  </li>
                ))}
              </ul>
            )}
            {detail.hiddenLeadCount > 0 ? (
              <p className="mt-3 text-[11px] text-zinc-500">
                {detail.hiddenLeadCount} more linked {detail.hiddenLeadCount === 1 ? "lead is" : "leads are"} outside your access.
              </p>
            ) : null}
          </PanelCard>

          <PanelCard title="Investments">
            <BookingsMiniList rows={investments} empty="No bookings linked to this client (within your access)." />
          </PanelCard>
          {paymentHistory ? (
            <PanelCard title={`Payment history · ${paymentHistory.length}`}>
              <PaymentHistoryList rows={paymentHistory} empty="No payments posted on this client's bookings." showBooking />
            </PanelCard>
          ) : null}
          <DocumentsPanel documents={documents} canUpload={detail.permissions.edit} uploadUrl={`/api/v1/clients/${id}/documents`} text={CLIENT_DOCUMENTS} />

          <ClientTimeline activities={detail.activities} />
        </div>
        <div className="space-y-6">
          {detail.permissions.assign ? <AssignClientPanel clientId={client.id} ownerId={client.ownerId} owners={owners} /> : null}
          <ClientFollowUpsPanel detail={detail} />
          <ClientNotePanel clientId={client.id} canEdit={detail.permissions.edit} />
        </div>
      </div>
    </section>
  );
}
