import type { Metadata } from "next";
import { LeadsListView } from "@/features/leads/components/list-view";

export const metadata: Metadata = { title: "Won leads" };

export default function WonLeadsPage({ searchParams }: PageProps<"/dashboard/leads/won">) {
  return (
    <LeadsListView
      view="won"
      title="Won leads"
      description="Booked opportunities in your scope. Filters, search, and sorting match the pipeline table view."
      pathname="/dashboard/leads/won"
      searchParams={searchParams}
      emptyMessage="No won leads yet. Leads become Won when a booking is confirmed."
    />
  );
}
