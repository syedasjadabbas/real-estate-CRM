import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { RestrictedState } from "@/components/ui/empty-state";
import { RecordPaymentForm } from "@/features/finance/components/record-payment-form";
import { businessToday } from "@/modules/bookings/today";
import { canDoFinance } from "@/modules/finance/policy";
import { listPaymentMethods } from "@/modules/finance/queries";
import { payableBookings } from "@/modules/finance/views";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Finance · Record payment" };

export default async function RecordPaymentPage({ searchParams }: PageProps<"/dashboard/finance/record">) {
  const actor = await requirePageUser();
  if (!canDoFinance(actor, "record")) return <RestrictedState />;
  const db = getDb();
  const [{ booking }, bookings, methods] = await Promise.all([searchParams, payableBookings(db, actor), listPaymentMethods(db, { activeOnly: true })]);
  return (
    <section className="space-y-6" aria-label="Record payment">
      <PageHeader
        as="h2"
        title="Record payment"
        description="Bookings from Token pending onward with a balance left. The amount can't exceed the outstanding balance."
      />
      <RecordPaymentForm bookings={bookings} methods={methods} defaultBookingId={typeof booking === "string" ? booking : ""} today={businessToday()} />
    </section>
  );
}
