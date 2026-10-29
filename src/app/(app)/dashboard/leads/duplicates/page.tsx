import type { Metadata } from "next";
import { LeadsListView } from "@/features/leads/components/list-view";

export const metadata: Metadata = { title: "Duplicate leads" };

export default function DuplicateLeadsPage({ searchParams }: PageProps<"/dashboard/leads/duplicates">) {
  return (
    <LeadsListView
      view="duplicates"
      title="Duplicate leads"
      description="Flagged duplicates and their originals. Search by phone, code, or related lead details."
      pathname="/dashboard/leads/duplicates"
      searchParams={searchParams}
      emptyMessage="No flagged duplicates."
    />
  );
}
