import type { Metadata } from "next";
import { LeadsListView } from "@/features/leads/components/list-view";

export const metadata: Metadata = { title: "Leads" };

export default function LeadsPage({ searchParams }: PageProps<"/dashboard/leads">) {
  return (
    <LeadsListView
      view="all"
      title="All leads"
      description="Search, filter, and act on leads in the current project scope."
      pathname="/dashboard/leads"
      searchParams={searchParams}
    />
  );
}
