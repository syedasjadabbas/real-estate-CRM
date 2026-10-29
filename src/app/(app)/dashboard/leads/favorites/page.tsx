import type { Metadata } from "next";
import { LeadsListView } from "@/features/leads/components/list-view";

export const metadata: Metadata = { title: "Favorite leads" };

export default function FavoriteLeadsPage({ searchParams }: PageProps<"/dashboard/leads/favorites">) {
  return (
    <LeadsListView
      view="favorites"
      title="Favorite leads"
      description="Star leads from the table to build your list. Filters, search, and sorting work the same as the table view."
      pathname="/dashboard/leads/favorites"
      searchParams={searchParams}
      emptyMessage="No starred leads yet. Use the ★ in any leads table."
    />
  );
}
