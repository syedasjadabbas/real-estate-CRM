import type { Metadata } from "next";
import { LeadsListView } from "@/features/leads/components/list-view";
import { STAGNATING_DAYS } from "@/modules/leads/constants";

export const metadata: Metadata = { title: "Stagnating leads" };

export default function StagnatingPage({ searchParams }: PageProps<"/dashboard/leads/stagnating">) {
  return (
    <LeadsListView
      view="stagnating"
      title="Stagnating leads"
      description={`Leads in the same stage for ${STAGNATING_DAYS} days or more, longest first.`}
      pathname="/dashboard/leads/stagnating"
      searchParams={searchParams}
      emptyMessage="No stagnating leads."
    />
  );
}
