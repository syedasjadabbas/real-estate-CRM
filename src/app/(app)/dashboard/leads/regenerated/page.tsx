import type { Metadata } from "next";
import { LeadsListView } from "@/features/leads/components/list-view";

export const metadata: Metadata = { title: "Repeat enquiries" };

export default function RegeneratedLeadsPage({ searchParams }: PageProps<"/dashboard/leads/regenerated">) {
  return (
    <LeadsListView
      view="regenerated"
      title="Repeat enquiries"
      description="Existing leads that inquired again (repeat inbound). Not yet worked since the re-inquiry are listed first."
      pathname="/dashboard/leads/regenerated"
      searchParams={searchParams}
      emptyMessage="No repeat enquiries."
    />
  );
}
