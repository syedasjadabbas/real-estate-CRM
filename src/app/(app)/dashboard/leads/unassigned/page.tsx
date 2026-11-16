import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ClaimList } from "@/features/leads/components/claim-list";
import { withLeadsAccess } from "@/features/leads/components/list-view";
import { canClaim, listUnassigned, UNASSIGNED_LIMIT } from "@/modules/leads/claims";
import { assignableUsers } from "@/modules/leads/queries";

export const metadata: Metadata = { title: "Unassigned leads" };

/** Leads no one owns yet in the selected project. Agents claim one (first come, first served); Admins assign one. */
export default async function UnassignedLeadsPage() {
  return withLeadsAccess(async ({ actor, db, projectId }) => {
    const [rows, owners] = await Promise.all([listUnassigned(db, actor, projectId), assignableUsers(db, actor)]);
    return (
      <section className="space-y-6" aria-label="Unassigned leads">
        <PageHeader
          as="h2"
          title="Unassigned leads"
          description={
            canClaim(actor)
              ? "Leads the rotation couldn't place, because no agent was available that day (on leave, day off or leads off). Claim one to make it yours: the first person to claim it owns it."
              : "Leads the rotation couldn't place, because no agent was available that day (on leave, day off or leads off). Assign one to someone, or open it. Agents can also claim them here."
          }
        />
        {rows.length === 0 ? (
          <EmptyState>No unassigned leads in this project.</EmptyState>
        ) : (
          <ClaimList
            rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
            canClaim={canClaim(actor)}
            owners={owners.map((o) => ({ id: o.id, name: o.name }))}
            limited={rows.length >= UNASSIGNED_LIMIT}
          />
        )}
      </section>
    );
  });
}
