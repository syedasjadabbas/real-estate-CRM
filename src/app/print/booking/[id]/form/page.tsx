import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { formatListedOn } from "@/features/inventory/format";
import { cn } from "@/lib/cn";
import { canDoBooking } from "@/modules/bookings/policy";
import { getBookingDetail, type BookingDetail } from "@/modules/bookings/queries";
import { businessToday } from "@/modules/bookings/today";
import { resolvePaymentPlan } from "@/modules/projects/payment-plan";
import { getProposalSettings } from "@/modules/tasks/settings";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { leadSources, leads, projects, units } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { PrintButton } from "../../../proposal/[id]/print-button";

export const metadata: Metadata = { title: "Booking form" };

const GOLD = "#b8902d";
const COPIES = [
  { key: "buyer", label: "Buyer copy" },
  { key: "developer", label: "Developer copy" },
  { key: "marketing", label: "Marketing copy" },
] as const;
type CopyKey = (typeof COPIES)[number]["key"];

const LEAD_SOURCE_OPTIONS = ["Walk-in", "Facebook / Instagram", "YouTube / Google", "Influencer", "Referral", "Overseas Campaign", "Other"] as const;

/** The template's "How did the buyer hear" box that matches the lead's source in the CRM. */
function sourceOption(source: string | null): (typeof LEAD_SOURCE_OPTIONS)[number] | null {
  if (!source) return null;
  const s = source.toLowerCase();
  if (s.includes("walk") || s.includes("site visit")) return "Walk-in";
  if (s.includes("facebook") || s.includes("instagram") || s.includes("meta")) return "Facebook / Instagram";
  if (s.includes("youtube") || s.includes("google")) return "YouTube / Google";
  if (s.includes("influencer")) return "Influencer";
  if (s.includes("referral") || s.includes("existing client")) return "Referral";
  if (s.includes("overseas")) return "Overseas Campaign";
  return "Other";
}

const pkr = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 0 });

const TERMS: [string, string][] = [
  ["Nature of Booking.", "This form is an application to reserve the townhouse described overleaf. It is not a sale, allotment or transfer of title. The booking becomes binding only when the Developer accepts it in writing and the Sale Agreement is signed."],
  ["Booking Amount & Payments.", "The booking amount must be paid by crossed cheque, pay order or bank transfer to the account designated by the Developer, against an official receipt. MZ Marketing representatives are not authorised to receive payment in their personal names."],
  ["Confirmation.", "The unit is reserved only after the booking amount is realised in the Developer's account and this form is countersigned. A dishonoured cheque or failed transfer cancels the reservation without notice."],
  ["Price & Charges.", "The sale price is as recorded on this form and confirmed in the Sale Agreement. Unless the Sale Agreement states otherwise, taxes, stamp duty, registration and transfer charges, utility connection fees and society or maintenance charges are payable by the Buyer as applicable by law."],
  ["Payment Plan.", "Instalments must be paid on or before their due dates. Delayed payments may attract a surcharge, and continued default may lead to cancellation, as set out in the Sale Agreement."],
  ["Cancellation & Refund.", "If the Buyer cancels, the amount paid is refunded after the deduction and within the period specified in the Sale Agreement or the Developer's written policy. No verbal assurance about refunds is valid."],
  ["Developer's Right to Cancel.", "The Developer may decline or cancel a booking if information or documents are false or incomplete, a payment is dishonoured, or the Buyer breaches these terms. Amounts received are then dealt with under clause 6."],
  ["Plans, Specifications & Marketing Materials.", "Brochures, renders, videos and advertisements are illustrative. The unit is built to the plans approved by the relevant authorities and the specifications in the Sale Agreement. Changes required by authorities or construction needs may be made if they do not materially reduce the unit's size or value."],
  ["Possession & Completion.", "Dates mentioned are estimates and depend on approvals, payments received and events beyond the Developer's control. Possession is given on the terms of the Sale Agreement once all dues are cleared. No returns, appreciation or resale value is promised or guaranteed."],
  ["Buyer's Documents.", "The Buyer must provide a valid CNIC or passport, photographs and proof of address. Overseas Pakistani buyers should provide NICOP or passport details, and any Power of Attorney must be properly executed and attested as required by law."],
  ["Transfer of Booking.", "The booking cannot be assigned, transferred or resold without the Developer's prior written consent and completion of its transfer procedure and fees."],
  ["Role of MZ Marketing.", "MZ Marketing acts as the project's marketing and sales partner. Its representatives cannot change the price, terms, payment plan or specifications, or give undertakings beyond the Developer's approved materials. Only terms agreed in writing and signed by the Developer are binding."],
  ["Privacy.", "Personal information is used to process this booking and to communicate about the project, and is shared only with the Developer and service providers who need it for that purpose."],
  ["Governing Law & Disputes.", "These terms are governed by the laws of Pakistan. Disputes will first be addressed through good-faith discussion, failing which the forum specified in the Sale Agreement applies."],
  ["Entire Understanding.", "This form and the Sale Agreement, once signed, are the whole understanding between the parties and replace any verbal statements."],
];

/** One A4 sheet. On screen it shows as a page with a shadow; in print each sheet starts a new page. */
function Sheet({ children }: { children: ReactNode }) {
  return (
    <section className="booking-sheet relative mx-auto flex w-[210mm] max-w-full flex-col bg-white text-zinc-900 shadow-hairline print:shadow-none" style={{ minHeight: "297mm" }}>
      {children}
    </section>
  );
}

function CopyBadge({ label }: { label: string }) {
  return (
    <span className="inline-block rounded-full px-5 py-1.5 text-[10px] font-black tracking-[0.2em] text-zinc-900 uppercase" style={{ background: GOLD }}>
      {label}
    </span>
  );
}

function Bar({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-2.5 px-3 py-0.5 text-[10.5px] font-black tracking-[0.15em] text-zinc-900 uppercase" style={{ background: GOLD }}>
      {children}
    </h2>
  );
}

/** A fill-in box from the template: label, then the value on the peach line (blank to write by hand). */
function Field({ label, value, className }: { label: string; value?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[8.5px] leading-3 tracking-[0.06em] text-zinc-600 uppercase">{label}</p>
      <div className="mt-px min-h-[19px] border-b border-zinc-300 bg-[#fde2da] px-1.5 py-px text-[11.5px] leading-[17px] font-semibold break-words">{value ?? ""}</div>
    </div>
  );
}

function Check({ label, checked = false }: { label: string; checked?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px]">
      <span className="inline-flex size-3.5 items-center justify-center border border-zinc-400 bg-white text-[10px] leading-none font-black">{checked ? "✓" : ""}</span>
      {label}
    </span>
  );
}

function Choices({ label, options, chosen }: { label: string; options: readonly string[]; chosen: string | null }) {
  return (
    <div>
      <p className="text-[8.5px] leading-3 tracking-[0.06em] text-zinc-600 uppercase">{label}</p>
      <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
        {options.map((o) => (
          <Check key={o} label={o} checked={o === chosen} />
        ))}
      </div>
    </div>
  );
}

function Footer({ page }: { page: 1 | 2 }) {
  const c = brand.contact;
  return (
    <footer className="mt-auto flex items-center justify-between gap-3 border-t border-zinc-300 px-[14mm] pt-2 pb-[8mm] text-[9px] text-zinc-500">
      <span>
        {brand.displayName} | {c.address} | {c.web} | {c.email} | {c.phone}
      </span>
      <span className="shrink-0">Page {page} of 2</span>
    </footer>
  );
}

type FormData = {
  ref: string;
  bookedOn: string;
  project: string;
  unitNo: string;
  area: string;
  block: string;
  buyer: string;
  mobile: string;
  email: string;
  total: string;
  amount: string;
  balance: string;
  plan: "Full Payment" | "Instalment Plan";
  source: (typeof LEAD_SOURCE_OPTIONS)[number] | null;
  executive: string;
};

function FormPage({ copy, d }: { copy: string; d: FormData }) {
  return (
    <Sheet>
      <header className="flex items-center justify-between gap-4 bg-[#0e0e0e] px-[14mm] py-[5mm] text-white">
        <div className="flex items-center gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- the company mark, printed as is */}
          <img src={brand.logo.src} width={brand.logo.width} height={brand.logo.height} alt={brand.logo.alt} className="h-[20mm] w-auto" />
          <CopyBadge label={copy} />
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black tracking-[0.35em] uppercase" style={{ color: GOLD }}>
            Townhouse development
          </p>
          <p className="text-[34px] leading-none font-black tracking-[0.02em]">BOOKING FORM</p>
          <p className="mt-1.5 text-[11px] text-zinc-300">Unit reservation and purchase application</p>
        </div>
      </header>

      <div className="flex-1 px-[14mm] pt-1">
        <Bar>1. Unit details</Bar>
        <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1">
          <Field label="Booking ref. no." value={d.ref} />
          <Field label="Date of booking" value={d.bookedOn} />
          <Field label="Project / society" value={d.project} />
          <Field label="Townhouse / unit no." value={d.unitNo} />
          <Field label="Covered area (sq. ft.)" value={d.area} />
          <Field label="Block / street" value={d.block} />
        </div>

        <Bar>2. Buyer details</Bar>
        <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1">
          <Field className="col-span-2" label="Full name (as per CNIC / passport)" value={d.buyer} />
          <Field label="Father's / husband's name" />
          <Field label="CNIC / passport no." />
          <Field label="Nationality" />
          <Field label="Occupation" />
          <Field label="Mobile / WhatsApp" value={d.mobile} />
          <Field label="Email" value={d.email} />
          <Field className="col-span-2" label="Mailing address" />
          <Choices label="Residential status" options={["Resident in Pakistan", "Overseas Pakistani"]} chosen={null} />
          <Field label="Country of residence (if overseas)" />
        </div>

        <Bar>3. Joint buyer / nominee (optional)</Bar>
        <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1">
          <Field label="Full name" />
          <Field label="Relationship to buyer" />
          <Field label="CNIC / passport no." />
          <Field label="Mobile" />
        </div>

        <Bar>4. Price &amp; payment</Bar>
        <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1">
          <Field label="Total sale price (PKR)" value={d.total} />
          <Field label="Booking amount received (PKR)" value={d.amount} />
          <div className="col-span-2">
            <Choices label="Payment mode" options={["Bank Transfer", "Cheque", "Pay Order", "Online Transfer"]} chosen={null} />
          </div>
          <Field label="Cheque / pay order / transaction no." />
          <Field label="Bank name" />
          <Choices label="Payment plan" options={["Full Payment", "Instalment Plan"]} chosen={d.plan} />
          <Field label="Balance amount (PKR)" value={d.balance} />
        </div>

        <Bar>5. Lead source &amp; sales executive</Bar>
        <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1">
          <div className="col-span-2">
            <Choices label="How did the buyer hear about the project?" options={LEAD_SOURCE_OPTIONS} chosen={d.source} />
          </div>
          <Field label="Sales executive name" value={d.executive} />
          <Field label="Referred by (if any)" />
        </div>

        <p className="mt-3 text-[10.5px] leading-[1.4]">
          <b>Declaration.</b> I/We confirm that the information given in this form is true and complete, and that I/We have read, understood and accepted the Terms &amp; Conditions on page 2.
        </p>
        <div className="mt-[11mm] grid grid-cols-3 gap-6 text-[10px] text-zinc-600">
          <p className="border-t border-zinc-800 pt-1">Buyer&apos;s Signature / Thumb Impression</p>
          <p className="border-t border-zinc-800 pt-1">Joint Buyer / Nominee Signature</p>
          <p className="border-t border-zinc-800 pt-1">{brand.displayName} Representative (Name &amp; Stamp)</p>
        </div>
      </div>
      <Footer page={1} />
    </Sheet>
  );
}

function TermsPage({ copy, buyer }: { copy: string; buyer: string }) {
  return (
    <Sheet>
      <header className="flex items-center justify-between gap-4 bg-[#0e0e0e] px-[14mm] py-[4mm] text-white">
        <div className="flex items-center gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- the company mark, printed as is */}
          <img src={brand.logo.src} width={brand.logo.width} height={brand.logo.height} alt={brand.logo.alt} className="h-[14mm] w-auto" />
          <CopyBadge label={copy} />
        </div>
        <div className="text-right">
          <p className="text-[28px] leading-none font-black tracking-[0.02em]">TERMS &amp; CONDITIONS</p>
          <p className="mt-1.5 text-[11px] text-zinc-300">Please read carefully before signing the booking form</p>
        </div>
      </header>

      <div className="flex-1 px-[14mm] pt-4">
        <ol className="space-y-2">
          {TERMS.map(([title, text], i) => (
            <li key={title} className="flex gap-3 text-[11px] leading-[1.45]">
              <span className="w-5 shrink-0 font-black" style={{ color: GOLD }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>
                <b>{title}</b> {text}
              </span>
            </li>
          ))}
        </ol>

        <Bar>Buyer acknowledgement</Bar>
        <p className="mt-2 text-[11px]">I/We have read, understood and accepted these Terms &amp; Conditions.</p>
        <div className="mt-1 grid grid-cols-[1fr_0.8fr_1.2fr] items-end gap-6">
          <Field label="Buyer's name" value={buyer} />
          <Field label="Date" />
          <div>
            <p className="text-[9px] tracking-[0.06em] text-zinc-600 uppercase">Signature / thumb impression</p>
            <div className="mt-[8mm] border-b border-zinc-800" />
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-zinc-300 bg-zinc-100 px-4 py-3">
          <p className="text-[12px] font-black tracking-[0.12em] uppercase">For office use only</p>
          <div className="mt-1 grid grid-cols-3 gap-4">
            <Field label="Received by" />
            <Field label="Receipt no." />
            <Field label="Date received" />
          </div>
          <div className="mt-2 grid grid-cols-[1fr_1.4fr] items-end gap-6">
            <Choices label="Booking status" options={["Confirmed", "Pending", "Cancelled"]} chosen={null} />
            <div>
              <p className="text-[9px] tracking-[0.06em] text-zinc-600 uppercase">Developer&apos;s authorised signatory (name, signature &amp; stamp)</p>
              <div className="mt-[8mm] border-b border-zinc-800" />
            </div>
          </div>
        </div>
      </div>
      <Footer page={2} />
    </Sheet>
  );
}

/**
 * Booking form in the client's template (MZ_Marketing_Townhouse_Booking_Form_New_Logo.pdf, 18 Nov 2026):
 * a two-page form (application, then Terms & Conditions) printed as a Buyer, Developer and Marketing copy.
 * What the CRM holds is filled in; the rest (CNIC, family, address, joint buyer, cheque) is left for the
 * buyer to write. It records nothing.
 */
export default async function BookingFormPage({ params, searchParams }: PageProps<"/print/booking/[id]/form">) {
  const actor = await requirePageUser();
  if (!canDoBooking(actor, "view")) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const db = getDb();
  let detail: BookingDetail;
  try {
    detail = await getBookingDetail(db, actor, id, businessToday());
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { booking, lead, unit } = detail;
  const [[extra], standard] = await Promise.all([
    db
      .select({ email: leads.email, source: leadSources.name, block: units.block, paymentPlan: projects.paymentPlan })
      .from(leads)
      .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .innerJoin(units, eq(units.id, booking.unitId))
      .innerJoin(projects, eq(projects.id, booking.projectId))
      .where(eq(leads.id, booking.leadId))
      .limit(1),
    getProposalSettings(db),
  ]);
  const plan = resolvePaymentPlan(extra?.paymentPlan, standard);
  const wanted = typeof sp.copy === "string" && COPIES.some((c) => c.key === sp.copy) ? (sp.copy as CopyKey) : null;
  const copies = wanted ? COPIES.filter((c) => c.key === wanted) : COPIES;

  const d: FormData = {
    ref: detail.ref ?? "",
    bookedOn: formatListedOn(businessToday(booking.createdAt)),
    project: detail.projectName,
    unitNo: unit.unitNo,
    area: booking.areaSqft ? pkr(booking.areaSqft) : "",
    block: extra?.block ?? "",
    buyer: detail.client?.name ?? lead.name,
    mobile: lead.phone,
    email: extra?.email ?? "",
    total: pkr(booking.totalSale),
    amount: pkr(booking.tokenAmount),
    balance: pkr(Math.max(0, booking.totalSale - booking.tokenAmount)),
    plan: plan.installmentCount > 0 ? "Instalment Plan" : "Full Payment",
    source: sourceOption(extra?.source ?? null),
    executive: detail.agentName ?? "",
  };

  const tab = (key: CopyKey | null, label: string) => (
    <Link
      key={label}
      href={key ? `/print/booking/${booking.id}/form?copy=${key}` : `/print/booking/${booking.id}/form`}
      aria-current={key === wanted ? "page" : undefined}
      className={buttonClasses({ variant: key === wanted ? "primary" : "secondary", size: "md" })}
    >
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen space-y-6 bg-zinc-200 py-6 print:min-h-0 print:space-y-0 print:bg-white print:py-0">
      {/* A4 sheets, one per printed page, with the template's colours kept when printing. */}
      <style>{`@page { size: A4; margin: 0; }
@media print { html, body { background: #fff !important; } .booking-sheet { page-break-after: always; break-after: page; width: 210mm !important; height: 297mm; min-height: 0 !important; overflow: hidden; } .booking-sheet:last-child { page-break-after: auto; break-after: auto; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`}</style>
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4 print:hidden">
        <Link href={`/dashboard/bookings/${booking.id}`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Back to booking
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          {tab(null, "All 3 copies")}
          {COPIES.map((c) => tab(c.key, c.label))}
          <PrintButton />
        </div>
      </div>
      {copies.flatMap((c) => [<FormPage key={`${c.key}-1`} copy={c.label} d={d} />, <TermsPage key={`${c.key}-2`} copy={c.label} buyer={d.buyer} />])}
    </div>
  );
}
