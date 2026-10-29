import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { BookingDetailsPanel, BookingStagePanel } from "@/features/bookings/components/booking-panels";
import { BookingStagePill, HoldOverdueChip } from "@/features/bookings/components/stage-pill";
import { PaymentHistoryList } from "@/features/finance/components/payment-history";
import { formatArea, formatListedOn, formatPrice } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { BOOKING_STAGE_LABELS, MILESTONE_RATIO, PAYMENT_DOCS_LABELS, type BookingStage } from "@/modules/bookings/constants";
import { canDoBooking } from "@/modules/bookings/policy";
import { getBookingDetail } from "@/modules/bookings/queries";
import { businessToday } from "@/modules/bookings/today";
import { PAYABLE_STAGES } from "@/modules/finance/constants";
import { canDoFinance } from "@/modules/finance/policy";
import { bookingPaymentHistory } from "@/modules/finance/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Booking" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "provisional-receipt", label: "Provisional receipt" },
  { key: "sales-order", label: "Sales order" },
] as const;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</p>
      <div className="mt-0.5 truncate text-sm font-bold">{children}</div>
    </div>
  );
}

export default async function BookingDetailPage({ params, searchParams }: PageProps<"/dashboard/bookings/[id]">) {
  const actor = await requirePageUser();
  if (!canDoBooking(actor, "view")) return <RestrictedState />;
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const active = TABS.find((t) => t.key === tab)?.key ?? "overview";
  let detail;
  try {
    detail = await getBookingDetail(getDb(), actor, id, businessToday());
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { booking, lead, unit, client, money } = detail;
  const payments = await bookingPaymentHistory(getDb(), actor, booking.id);
  const canRecord = canDoFinance(actor, "record") && (PAYABLE_STAGES as readonly string[]).includes(booking.stage) && money.outstanding > 0;

  return (
    <section className="space-y-6" aria-label={`Booking for ${lead.name}`}>
      <PageHeader
        as="h2"
        title={`${lead.name} · Unit ${unit.unitNo}`}
        description={`${detail.projectName} · Sales agent ${detail.agentName ?? "—"} · Created ${formatDateTime(booking.createdAt)}`}
        actions={
          <>
            <BookingStagePill stage={booking.stage} />
            <Link href="/dashboard/bookings" className={buttonClasses({ variant: "secondary", size: "lg" })}>
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to list
            </Link>
          </>
        }
      />

      <nav
        aria-label="Booking views"
        className="flex gap-1.5 overflow-x-auto rounded-2xl border border-zinc-200/80 bg-white p-1.5 shadow-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "overview" ? `/dashboard/bookings/${booking.id}` : `/dashboard/bookings/${booking.id}?tab=${t.key}`}
            aria-current={t.key === active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center rounded-xl px-3.5 py-2 text-xs leading-4 font-bold whitespace-nowrap transition-colors",
              t.key === active ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-zinc-100",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {active !== "overview" ? (
        <PanelCard title={active === "provisional-receipt" ? "Provisional receipt" : "Sales order"}>
          <EmptyState size="sm">
            The printable {active === "provisional-receipt" ? "provisional receipt" : "sales order"} will be added when the client provides its template (Q-B5).
            No document number has been issued.
          </EmptyState>
        </PanelCard>
      ) : (
        <>
          <Card className="p-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
              <Fact label="Total sale">{formatPrice(booking.totalSale)}</Fact>
              <Fact label="Paid">
                {formatPrice(money.paid)} <span className="text-zinc-400">/ {formatPrice(money.total)}</span>
              </Fact>
              <Fact label={`${Math.round(MILESTONE_RATIO * 100)}% milestone`}>{money.milestoneMet ? "Met" : "Not met"}</Fact>
              <Fact label="Reserved until">
                <span className="inline-flex items-center gap-1.5">
                  {formatListedOn(booking.reservedUntil)}
                  {detail.holdOverdue ? <HoldOverdueChip /> : null}
                </span>
              </Fact>
              <Fact label="Agreement sent">{booking.agreementSentOn ? formatListedOn(booking.agreementSentOn) : "Not sent"}</Fact>
              <Fact label="Payment docs">{PAYMENT_DOCS_LABELS[booking.paymentDocsStatus]}</Fact>
            </div>
            <p className="mt-4 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
              Paid is the sum of payments posted by Finance minus approved reversals. Outstanding: {formatPrice(money.outstanding)}.
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-6">
              <PanelCard title="Sale">
                <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                  {[
                    ["Lead", lead.visible ? <Link key="l" href={`/dashboard/leads/${lead.id}`} className="font-bold text-brand hover:underline">{lead.name} ({lead.code})</Link> : `${lead.name} (${lead.code})`],
                    ["Phone", lead.phone],
                    ["Unit", <Link key="u" href={`/dashboard/inventory/${unit.id}`} className="font-bold text-brand hover:underline">{unit.unitNo}{unit.floor ? ` · ${unit.floor}` : ""}</Link>],
                    ["Area (snapshot)", formatArea(booking.areaSqft)],
                    ["Per sq ft rate", formatPrice(booking.ratePerSqft)],
                    ["Token amount", formatPrice(booking.tokenAmount)],
                    [
                      "Client",
                      client ? (client.visible ? <Link key="c" href={`/dashboard/clients/${client.id}`} className="font-bold text-brand hover:underline">{client.name}</Link> : "Linked (another team)") : "Created or linked on confirmation",
                    ],
                    ["Confirmed", booking.confirmedAt ? formatDateTime(booking.confirmedAt) : "—"],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="min-w-0">
                      <dt className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</dt>
                      <dd className="mt-0.5 font-semibold text-zinc-900">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 border-t border-zinc-100 pt-3">
                  <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">Payment instructions (shown to buyer)</p>
                  <p className="mt-1 text-xs whitespace-pre-line text-zinc-800">{booking.paymentInstructions ?? "—"}</p>
                </div>
              </PanelCard>

              <PanelCard title={`Stage history · ${detail.history.length}`}>
                <ol className="space-y-2.5">
                  {detail.history.map((h) => (
                    <li key={h.id} className="rounded-xl border border-zinc-200/80 px-3 py-2.5 shadow-hairline">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold">
                          {h.fromStage ? `${BOOKING_STAGE_LABELS[h.fromStage as BookingStage]} → ` : ""}
                          {BOOKING_STAGE_LABELS[h.toStage as BookingStage]}
                        </p>
                        <BookingStagePill stage={h.toStage as BookingStage} />
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        {formatDateTime(h.createdAt)} · {h.actorName ?? "System"}
                      </p>
                      {h.note ? <p className="mt-1.5 text-xs whitespace-pre-line text-zinc-800">{h.note}</p> : null}
                    </li>
                  ))}
                </ol>
              </PanelCard>
            </div>
            <div className="space-y-6">
              <BookingStagePanel detail={detail} />
              {payments ? (
                <PanelCard title={`Payments · ${payments.length}`}>
                  <PaymentHistoryList rows={payments} empty="No payments posted yet." />
                  {canRecord ? (
                    <Link
                      href={`/dashboard/finance/record?booking=${booking.id}`}
                      className={buttonClasses({ variant: "secondary", size: "lg", className: "mt-3" })}
                    >
                      Record payment →
                    </Link>
                  ) : null}
                </PanelCard>
              ) : null}
              {detail.permissions.editDetails ? <BookingDetailsPanel detail={detail} /> : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
