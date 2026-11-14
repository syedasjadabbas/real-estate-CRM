import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { resolvePaymentPlan } from "@/modules/projects/payment-plan";
import { projects } from "@/server/db/schema";
import { BookingPlan } from "./plan";
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
import { getProposalSettings } from "@/modules/tasks/settings";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { PrintButton } from "../../../proposal/[id]/print-button";

export const metadata: Metadata = { title: "Booking form (demo)" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="relative break-inside-avoid space-y-1 border-t border-zinc-200 pt-4">
      <h2 className="mb-2 text-[11px] font-black tracking-[0.2em] text-[#107c41] uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-zinc-200 py-1.5 text-sm">
      <span className="shrink-0 text-zinc-600">{label}</span>
      <span className="min-w-0 text-right font-bold tabular-nums">{value ?? <span className="inline-block w-48" aria-hidden="true" />}</span>
    </div>
  );
}

const TERMS = [
  "The booking is confirmed only after the token amount is received and realised.",
  "The down payment is due as per the payment plan; installments fall due on the dates shown in the payment schedule.",
  "Late payments may attract charges, and the booking may be cancelled as per company policy after due notice.",
  "The area and price are as per the company's inventory on the booking date; final measurements may vary slightly.",
  "Transfer of the unit is subject to clearing all dues and the company's transfer policy.",
  "The applicant has read and accepts the terms of the booking form and the sales order.",
];

/**
 * DEMO booking form (owner, 14 Nov 2026): a sample application layout filled from the booking, with
 * blank lines for what the CRM doesn't hold (CNIC, address, next of kin). It records nothing and
 * issues no form number; the final layout follows the client's template (Q-B5).
 */
export default async function BookingFormDemo({ params }: PageProps<"/print/booking/[id]/form">) {
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
  const { booking, lead, unit } = detail;
  const plan = await getProposalSettings(getDb());
  // The project's own payment plan, falling back to the standard one (owner, 14 Nov 2026).
  const [projectPlan] = await getDb().select({ paymentPlan: projects.paymentPlan }).from(projects).where(eq(projects.id, booking.projectId)).limit(1);

  return (
    <div className="min-h-screen bg-zinc-100 py-6 print:min-h-0 print:bg-white print:py-0">
      <style>{"@media print { html, body { background: #fff !important; } }"}</style>
      <div className="mx-auto mb-4 flex max-w-[794px] flex-wrap items-center justify-between gap-2 px-4 print:hidden">
        <Link href={`/dashboard/bookings/${booking.id}`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
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
            <p className="text-xl font-black tracking-[-0.02em] text-[#107c41]">BOOKING FORM</p>
            <p className="text-xs text-zinc-600">
              Form no: <span className="font-bold">DEMO (not issued)</span>
            </p>
            <p className="text-xs text-zinc-600">Date: {formatDateTime(booking.createdAt)}</p>
          </div>
        </header>

        <div className="relative flex gap-4">
          <div className="flex-1">
            <Section title="Applicant">
              <Row label="Full name" value={lead.name} />
              <Row label="Father / husband name" />
              <Row label="CNIC / passport no" />
              <Row label="Mobile" value={lead.phone} />
              <Row label="Email" />
              <Row label="Postal address" />
              <Row label="Nationality" />
            </Section>
          </div>
          <div className="hidden h-36 w-28 shrink-0 items-center justify-center border-2 border-dashed border-zinc-300 text-center text-[10px] font-semibold text-zinc-400 sm:flex print:flex">
            Applicant photo
          </div>
        </div>

        <Section title="Next of kin">
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label="Name" />
            <Row label="Relation" />
            <Row label="CNIC" />
            <Row label="Mobile" />
          </div>
        </Section>

        <Section title="Property">
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label="Project" value={detail.projectName} />
            <Row label="Unit no" value={unit.unitNo} />
            <Row label="Floor" value={unit.floor ?? "—"} />
            <Row label="Area" value={formatArea(booking.areaSqft)} />
            <Row label="Rate per sq ft" value={formatPrice(booking.ratePerSqft)} />
            <Row label="Total price" value={formatPrice(booking.totalSale)} />
          </div>
        </Section>

        {/* A long schedule may run onto the next page, so this section may break (owner, 14 Nov 2026). */}
        <section className="relative space-y-2 border-t border-zinc-200 pt-4">
          <h2 className="mb-2 text-[11px] font-black tracking-[0.2em] text-[#107c41] uppercase">Payment plan</h2>
          <BookingPlan
            total={booking.totalSale}
            token={booking.tokenAmount}
            bookedOn={businessToday(booking.createdAt)}
            plan={resolvePaymentPlan(projectPlan?.paymentPlan, plan)}
          />
          <p className="pt-1 text-[11px] text-zinc-500">Sales agent: {detail.agentName ?? "—"}</p>
        </section>

        <Section title="Terms and conditions">
          <ol className="list-decimal space-y-1 pl-5 text-[11px] leading-5 text-zinc-700">
            {TERMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </Section>

        <Section title="Declaration">
          <p className="text-[11px] leading-5 text-zinc-700">
            I declare that the information above is correct and that I have read, understood and accept the terms and conditions of this booking.
          </p>
          {/* Signed by the client and MZ MARKETING only (owner, 14 Nov 2026). */}
          <div className="grid grid-cols-2 gap-10 pt-12 text-xs">
            <div className="border-t border-zinc-400 pt-1 text-center text-zinc-600">Applicant signature &amp; thumb</div>
            <div className="border-t border-zinc-400 pt-1 text-center text-zinc-600">For {brand.name}</div>
          </div>
        </Section>

        <p className="relative rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-[11px] font-semibold text-amber-900">
          Sample layout for review. The final booking form follows the client&apos;s template (Q-B5); this demo issues no form number and records nothing.
        </p>
      </article>
    </div>
  );
}
