import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ClaimList } from "@/features/leads/components/claim-list";
import { withLeadsAccess } from "@/features/leads/components/list-view";
import { canClaim, listUnassigned } from "@/modules/leads/claims";

export const metadata: Metadata = { title: "Unassigned leads" };

/** Leads no one owns yet in the selected project. The first person to claim one gets it. */
export default async function UnassignedLeadsPage() {
  return withLeadsAccess(async ({ actor, db, projectId }) => {
    const rows = await listUnassigned(db, actor, projectId);
    return (
      <section className="space-y-6" aria-label="Unassigned leads">
        <PageHeader
          as="h2"
          title="Unassigned leads"
          description="Leads automatic assignment couldn't place, because every agent was unavailable or full. The first person to claim one owns it; after that only a manager or admin can reassign it."
        />
        {rows.length === 0 ? (
          <EmptyState>No unassigned leads in this project.</EmptyState>
        ) : (
          <ClaimList rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} canClaim={canClaim(actor)} />
        )}
      </section>
    );
  });
}
