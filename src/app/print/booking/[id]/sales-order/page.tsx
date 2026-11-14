import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { formatArea, formatPrice } from "@/features/inventory/format";
import { formatDateTime } from "@/features/leads/format";
import { canDoBooking } from "@/modules/bookings/policy";
import { getBookingDetail, type BookingDetail } from "@/modules/bookings/queries";
import { businessToday } from "@/modules/bookings/today";
import { resolvePaymentPlan } from "@/modules/projects/payment-plan";
import { getProposalSettings } from "@/modules/tasks/settings";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { BookingPlan } from "../form/plan";
import { PrintButton } from "../../../proposal/[id]/print-button";

export const metadata: Metadata = { title: "Sales order (demo)" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="relative space-y-1 border-t border-zinc-200 pt-4">
      <h2 className="mb-2 text-[11px] font-black tracking-[0.2em] text-[#107c41] uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value?: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-zinc-200 py-1.5 text-sm">
      <span className="shrink-0 text-zinc-600">{label}</span>
      <span className={`min-w-0 text-right tabular-nums ${strong ? "font-black" : "font-bold"}`}>{value ?? <span className="inline-block w-48" aria-hidden="true" />}</span>
    </div>
  );
}

const TERMS = [
  "This sales order confirms the sale of the unit above to the buyer at the final price shown.",
  "The remaining amount is payable as per the payment schedule; installments fall due on the dates shown.",
  "Late payments may attract charges, and the company may cancel the sale after due notice as per its policy.",
  "Possession is handed over on payment of the amount due on possession and clearance of all dues.",
  "Transfer or resale of the unit is subject to the company's transfer policy and clearance of dues.",
  "This sales order is read together with the signed booking form and the receipts issued.",
];

/**
 * DEMO sales order (owner, 14 Nov 2026): the formal sale confirmation, issued at Complete Down Payment
 * or Closed Won, filled from the booking and its project's payment plan. It issues no number and
 * records nothing; the final layout follows the client's template (Q-B5).
 */
export default async function SalesOrderDemo({ params }: PageProps<"/print/booking/[id]/sales-order">) {
  const actor = await requirePageUser();
  if (!canDoBooking(actor, "view")) notFound();
  const { id } = await params;
  let detail: BookingDetail;
  try {
    detail = await getBookingDetail(getDb(), actor, id, businessToday());
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { booking, lead, unit, money } = detail;
  const [standard, [project]] = await Promise.all([
    getProposalSettings(getDb()),
    getDb().select({ paymentPlan: projects.paymentPlan }).from(projects).where(eq(projects.id, booking.projectId)).limit(1),
  ]);
  const discount = booking.discountPct ?? 0;
  const listPrice = discount > 0 && discount < 100 ? Math.round(booking.totalSale / (1 - discount / 100)) : booking.totalSale;

  return (
    <div className="min-h-screen bg-zinc-100 py-6 print:min-h-0 print:bg-white print:py-0">
      <style>{"@media print { html, body { background: #fff !important; } }"}</style>
      <div className="mx-auto mb-4 flex max-w-[794px] flex-wrap items-center justify-between gap-2 px-4 print:hidden">
        <Link href={`/dashboard/bookings/${booking.id}?tab=sales-order`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Back to booking
        </Link>
        <PrintButton />
      </div>
      <article className="relative mx-auto max-w-[794px] space-y-5 overflow-hidden bg-white px-6 py-8 shadow-hairline sm:px-12 sm:py-10 print:max-w-none print:px-0 print:py-0 print:shadow-none">
        <p aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-[120px] font-black tracking-[0.2em] text-zinc-100 select-none -rotate-12">
          DEMO
        </p>

        <header className="relative flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#107c41] pb-4">
          <div>
            <p className="text-2xl font-black tracking-[-0.025em]">{brand.name}</p>
            <p className="text-xs text-zinc-500">{detail.projectName}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-black tracking-[-0.02em] text-[#107c41]">SALES ORDER</p>
            <p className="text-xs text-zinc-600">
              Order no: <span className="font-bold">DEMO (not issued)</span>
            </p>
            <p className="text-xs text-zinc-600">Date: {formatDateTime(new Date())}</p>
            <p className="text-xs text-zinc-600">Booking date: {formatDateTime(booking.createdAt)}</p>
          </div>
        </header>

        <Section title="Buyer">
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label="Name" value={lead.name} />
            <Row label="Mobile" value={lead.phone} />
            <Row label="CNIC / passport no" />
            <Row label="Postal address" />
          </div>
        </Section>

        <Section title="Property">
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label="Project" value={detail.projectName} />
            <Row label="Unit no" value={unit.unitNo} />
            <Row label="Floor" value={unit.floor ?? "—"} />
            <Row label="Area" value={formatArea(booking.areaSqft)} />
          </div>
        </Section>

        <Section title="Price">
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label="Inventory price" value={formatPrice(listPrice)} />
            <Row label="Discount" value={discount > 0 ? `${discount}%` : "None"} />
            <Row label="Final sale price" value={formatPrice(booking.totalSale)} strong />
            <Row label="Rate per sq ft" value={formatPrice(booking.ratePerSqft)} />
            <Row label="Received to date (posted)" value={formatPrice(money.paid)} />
            <Row label="Balance" value={formatPrice(money.outstanding)} strong />
          </div>
        </Section>

        <section className="relative space-y-2 border-t border-zinc-200 pt-4">
          <h2 className="mb-2 text-[11px] font-black tracking-[0.2em] text-[#107c41] uppercase">Payment plan</h2>
          <BookingPlan total={booking.totalSale} token={booking.tokenAmount} bookedOn={businessToday(booking.createdAt)} plan={resolvePaymentPlan(project?.paymentPlan, standard)} />
          <p className="pt-1 text-[11px] text-zinc-500">Sales agent: {detail.agentName ?? "—"}</p>
        </section>

        <Section title="Terms of sale">
          <ol className="list-decimal space-y-1 pl-5 text-[11px] leading-5 text-zinc-700">
            {TERMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </Section>

        <Section title="Acceptance">
          <div className="grid grid-cols-2 gap-10 pt-12 text-xs">
            <div className="border-t border-zinc-400 pt-1 text-center text-zinc-600">Buyer signature &amp; thumb</div>
            <div className="border-t border-zinc-400 pt-1 text-center text-zinc-600">For {brand.name} (authorised signatory)</div>
          </div>
        </Section>

        <p className="relative rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-[11px] font-semibold text-amber-900">
          Sample layout for review. The final sales order follows the client&apos;s template (Q-B5); this demo issues no order number and records nothing.
        </p>
      </article>
    </div>
  );
}
