import { ArrowLeft } from "lucide-react";
import { listBookingProofs } from "@/modules/bookings/proofs";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { DecideReversalForm, RequestReversalForm } from "@/features/finance/components/reversal-forms";
import { formatListedOn, formatPrice } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { canDoFinance, canSeeItemisedPayments } from "@/modules/finance/policy";
import { PAYMENT_TYPE_LABELS } from "@/modules/finance/constants";
import { listPaymentProofs } from "@/modules/finance/proofs";
import { getPaymentDetail } from "@/modules/finance/views";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Finance · Payment" };

const ACTION_LABELS: Record<string, string> = {
  "payment.record": "Payment posted",
  "payment.reversal_requested": "Reversal requested",
  "payment.reversal_approved": "Reversal approved and posted",
  "payment.reversal_approved_emergency": "Reversal approved by super admin (emergency)",
  "payment.reversal_rejected": "Reversal rejected",
  "payment.proof_upload": "Payment proof attached",
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</p>
      <div className="mt-0.5 truncate text-sm font-bold">{children}</div>
    </div>
  );
}

export default async function PaymentDetailPage({ params }: PageProps<"/dashboard/finance/payments/[id]">) {
  const actor = await requirePageUser();
  if (!canSeeItemisedPayments(actor)) return <RestrictedState />;
  const { id } = await params;
  let detail;
  try {
    detail = await getPaymentDetail(getDb(), actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { entry, original, reversal, booking, permissions } = detail;
  const proofs = await listPaymentProofs(getDb(), actor, original.id);
  // The agent's transfer screenshots on the booking, to check against this payment (14 Nov 2026).
  const bookingProofs = await listBookingProofs(getDb(), actor, booking.id).catch(() => []);
  const isReversal = entry.kind === "reversal";
  const back = canDoFinance(actor, "viewAll") ? "/dashboard/finance" : "/dashboard/finance/approvals";

  return (
    <section className="space-y-6" aria-label={isReversal ? `Reversal ${entry.label}` : `Receipt ${entry.label}`}>
      <PageHeader
        as="h2"
        title={isReversal ? `Reversal ${entry.label}` : `Receipt ${entry.label}`}
        description={`${booking.leadName} (${booking.leadCode}) · Unit ${booking.unitNo} · ${booking.projectName}`}
        actions={
          <Link href={back} className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back
          </Link>
        }
      />

      <Card className="p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <Fact label="Amount">
            <span className={isReversal ? "text-rose-700" : undefined}>
              {isReversal ? "−" : ""}
              {formatPrice(entry.amount)}
            </span>
          </Fact>
          <Fact label="Type">{PAYMENT_TYPE_LABELS[entry.type]}</Fact>
          <Fact label="Received on">{formatListedOn(entry.receivedOn)}</Fact>
          <Fact label="Method">{original.methodName ?? "—"}</Fact>
          <Fact label="Reference">{original.reference ?? "—"}</Fact>
          <Fact label="Status">{isReversal ? `Reverses receipt ${original.label}` : reversal ? `Reversed (${reversal.label})` : detail.pendingRequestId ? "Reversal pending approval" : "Posted"}</Fact>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <PanelCard title="Entry">
            <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              {[
                ["Booking", <Link key="b" href={`/dashboard/bookings/${booking.id}`} className="font-bold text-brand hover:underline">{booking.leadName} · Unit {booking.unitNo}</Link>],
                ["Recorded", `${formatDateTime(entry.recordedAt)} · ${entry.recordedByName ?? "—"}`],
                ["Original receipt", isReversal ? <Link key="o" href={`/dashboard/finance/payments/${original.id}`} className="font-bold text-brand hover:underline">{original.label}</Link> : original.label],
                ["Reversal", reversal ? (isReversal ? reversal.label : <Link key="r" href={`/dashboard/finance/payments/${reversal.id}`} className="font-bold text-brand hover:underline">{reversal.label}</Link>) : "—"],
                ["Note", (isReversal ? entry.note : original.note) ?? "—"],
              ].map(([label, value]) => (
                <div key={String(label)} className="min-w-0">
                  <dt className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</dt>
                  <dd className="mt-0.5 font-semibold text-zinc-900">{value}</dd>
                </div>
              ))}
            </dl>
          </PanelCard>

          <PanelCard title={`Audit trail · ${detail.trail.length}`}>
            {detail.trail.length === 0 ? (
              <EmptyState size="sm">No audit entries.</EmptyState>
            ) : (
              <ol className="space-y-2">
                {detail.trail.map((t) => (
                  <li key={t.id} className="rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
                    <p className="font-bold">{ACTION_LABELS[t.action] ?? t.action}</p>
                    <p className="text-[11px] text-zinc-500">
                      {formatDateTime(t.createdAt)} · {t.actorName ?? "System"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </PanelCard>
        </div>
        <div className="space-y-6">
          <DocumentsPanel
            documents={proofs}
            canUpload={canDoFinance(actor, "record")}
            uploadUrl={`/api/v1/finance/payments/${original.id}/proofs`}
            fileBase="/api/v1/finance/proofs"
            text={{ title: "Payment proof", empty: "No proof attached. Proof is optional.", field: "Attach a receipt or photo", button: "Attach proof", uploaded: "Proof attached.", noun: "Proofs" }}
          />
          {bookingProofs.length ? (
            <DocumentsPanel
              documents={bookingProofs}
              canUpload={false}
              uploadUrl={`/api/v1/bookings/${booking.id}/proofs`}
              fileBase="/api/v1/bookings/proofs"
              text={{ title: "Proofs from the booking", empty: "", field: "", button: "", uploaded: "", noun: "Proofs" }}
            />
          ) : null}
          <PanelCard title="Reversal">
            <div className="space-y-4">
              {detail.requests.length === 0 ? <p className="text-xs text-zinc-600">No reversal has been requested.</p> : null}
              {detail.requests.map((r) => (
                <div key={r.id} className="rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
                  <p className="font-bold capitalize">{r.status}</p>
                  <p className="text-zinc-800">“{r.reason}”</p>
                  <p className="text-[11px] text-zinc-500">
                    Requested by {r.requestedByName ?? "—"} · {formatDateTime(r.createdAt)}
                  </p>
                  {r.decidedAt ? (
                    <p className="text-[11px] text-zinc-500">
                      {r.status === "approved" ? "Approved" : "Rejected"} by {r.decidedByName ?? "—"} · {formatDateTime(r.decidedAt)}
                      {r.decisionNote ? ` · ${r.decisionNote}` : ""}
                    </p>
                  ) : null}
                </div>
              ))}
              {permissions.decide && detail.pendingRequestId ? <DecideReversalForm requestId={detail.pendingRequestId} /> : null}
              {permissions.requestReversal ? <RequestReversalForm paymentId={original.id} /> : null}
            </div>
          </PanelCard>
        </div>
      </div>
    </section>
  );
}
