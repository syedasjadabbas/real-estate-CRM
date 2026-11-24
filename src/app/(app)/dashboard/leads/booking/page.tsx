import type { Metadata } from "next";
import { LeadsListView } from "@/features/leads/components/list-view";

export const metadata: Metadata = { title: "Booking in process" };

export default function BookingInProcessPage({ searchParams }: PageProps<"/dashboard/leads/booking">) {
  return <LeadsListView view="booking" title="Booking in process" description="Leads moving through a booking." pathname="/dashboard/leads/booking" searchParams={searchParams} emptyMessage="No leads here right now." />;
}
