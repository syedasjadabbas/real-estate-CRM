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
import { listBookingProofs } from "@/modules/bookings/proofs";
import { businessToday } from "@/modules/bookings/today";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { PrintButton } from "../../../proposal/[id]/print-button";

export const metadata: Metadata = { title: "Provisional receipt (demo)" };

function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-zinc-100 py-1.5 text-sm">
      <span className="text-zinc-600">{label}</span>
      <span className={strong ? "text-right font-black tabular-nums" : "text-right font-bold tabular-nums"}>{value}</span>
    </div>
  );
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ""}`;
  return [h ? `${ONES[h]} Hundred` : "", rest].filter(Boolean).join(" ");
}
/** Rupees in words, Pakistani style (crore, lakh, thousand). */
function rupeesInWords(amount: number) {
  let n = Math.round(amount);
  if (n === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  for (const [size, name] of [[10_000_000, "Crore"], [100_000, "Lakh"], [1_000, "Thousand"]] as const) {
    const q = Math.floor(n / size);
    if (q) parts.push(`${below1000(q)} ${name}`);
    n %= size;
  }
  if (n) parts.push(below1000(n));
  return `${parts.join(" ")} Rupees Only`;
}

/**
 * DEMO provisional receipt (owner, 14 Nov 2026). A sample layout filled from the booking until the
 * client sends its template (Q-B5); it issues no document number and records nothing.
 */
export default async function ProvisionalReceiptDemo({ params }: PageProps<"/print/booking/[id]/receipt">) {
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
  const received = money.paid > 0 ? money.paid : booking.tokenAmount;
  // The payment proofs on the booking (transfer screenshots, cheque or cash photos) print with the receipt.
  const proofs = await listBookingProofs(getDb(), actor, booking.id);
  const images = proofs.filter((p) => p.mime.startsWith("image/"));
  const others = proofs.filter((p) => !p.mime.startsWith("image/"));

  return (
    <div className="min-h-screen bg-zinc-100 py-6 print:min-h-0 print:bg-white print:py-0">
      <style>{"@media print { html, body { background: #fff !important; } }"}</style>
      <div className="mx-auto mb-4 flex max-w-[794px] flex-wrap items-center justify-between gap-2 px-4 print:hidden">
        <Link href={`/dashboard/bookings/${booking.id}?tab=provisional-receipt`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Back to booking
        </Link>
        <PrintButton />
      </div>
      <article className="relative mx-auto max-w-[794px] space-y-6 overflow-hidden bg-white px-6 py-8 shadow-hairline sm:px-12 sm:py-10 print:max-w-none print:px-0 print:py-0 print:shadow-none">
        {/* Watermark: this is a sample layout, not the client's document. */}
        <p aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-[120px] font-black tracking-[0.2em] text-zinc-100 select-none -rotate-12">
          DEMO
        </p>

        <header className="relative flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#107c41] pb-4">
          <div>
            <p className="text-2xl font-black tracking-[-0.025em]">{brand.name}</p>
            <p className="text-xs text-zinc-500">Real Estate · {detail.projectName}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-black tracking-[-0.02em] text-[#107c41]">PROVISIONAL RECEIPT</p>
            <p className="text-xs text-zinc-600">
              Receipt no: <span className="font-bold">DEMO (not issued)</span>
            </p>
            <p className="text-xs text-zinc-600">Date: {formatDateTime(booking.createdAt)}</p>
          </div>
        </header>

        <section className="relative space-y-1">
          <p className="text-[11px] font-black tracking-[0.2em] text-[#107c41] uppercase">Received from</p>
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label="Customer" value={lead.name} />
            <Row label="Phone" value={lead.phone} />
            <Row label="Lead code" value={lead.code} />
            <Row label="CNIC" value="__________________" />
          </div>
        </section>

        <section className="relative space-y-1">
          <p className="text-[11px] font-black tracking-[0.2em] text-[#107c41] uppercase">Property</p>
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label="Project" value={detail.projectName} />
            <Row label="Unit" value={unit.unitNo} />
            <Row label="Floor" value={unit.floor ?? "—"} />
            <Row label="Area" value={formatArea(booking.areaSqft)} />
            <Row label="Rate per sq ft" value={formatPrice(booking.ratePerSqft)} />
            <Row label="Total sale value" value={formatPrice(booking.totalSale)} />
          </div>
        </section>

        <section className="relative space-y-1">
          <p className="text-[11px] font-black tracking-[0.2em] text-[#107c41] uppercase">Payment</p>
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label={money.paid > 0 ? "Amount received to date" : "Token amount"} value={formatPrice(received)} strong />
            <Row label="Balance" value={formatPrice(booking.totalSale - received)} />
            <Row label="Payment method" value="__________________" />
            <Row label="Sales agent" value={detail.agentName ?? "—"} />
          </div>
          <p className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
            <span className="text-zinc-600">Amount in words: </span>
            <span className="font-bold">{rupeesInWords(received)}</span>
          </p>
        </section>

        {proofs.length ? (
          <section className="relative break-inside-avoid space-y-2">
            <p className="text-[11px] font-black tracking-[0.2em] text-[#107c41] uppercase">Payment proof</p>
            {images.length ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {images.map((p) => (
                  <figure key={p.id} className="break-inside-avoid rounded-lg border border-zinc-200 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a private, authenticated file, not an optimisable asset */}
                    <img src={`/api/v1/bookings/proofs/${p.id}`} alt={`Payment proof: ${p.name}`} className="max-h-[320px] w-full object-contain" />
                    <figcaption className="pt-1 text-[10px] text-zinc-500">{p.name}</figcaption>
                  </figure>
                ))}
              </div>
            ) : null}
            {others.length ? <p className="text-[11px] text-zinc-600">Also attached: {others.map((p) => p.name).join(", ")}</p> : null}
          </section>
        ) : null}

        <section className="relative text-[11px] leading-5 text-zinc-600">
          <p>
            This provisional receipt acknowledges the amount above against the unit shown. It is subject to realisation of the payment and to the terms of the
            booking form and sales order. The unit is held as per the booking terms.
          </p>
        </section>

        {/* The company signs a receipt; the customer doesn't (owner, 14 Nov 2026). */}
        <footer className="relative flex justify-end pt-10 text-xs">
          <div className="w-1/2 border-t border-zinc-400 pt-1 text-center text-zinc-600">For {brand.name} (authorised signatory)</div>
        </footer>

        <p className="relative rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-[11px] font-semibold text-amber-900">
          Sample layout for review. The final receipt follows the client&apos;s template (Q-B5); this demo issues no receipt number and records nothing.
        </p>
      </article>
    </div>
  );
}
