import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { LeadCreateForm } from "@/features/leads/components/lead-create-form";
import { withLeadsAccess } from "@/features/leads/components/list-view";
import { canDo } from "@/modules/leads/policy";
import { activeProjects, assignableUsers, leadLookups } from "@/modules/leads/queries";

export const metadata: Metadata = { title: "Add lead" };

export default function NewLeadPage() {
  return withLeadsAccess(async ({ actor, db, projectId }) => {
    if (!canDo(actor, "create")) return <RestrictedState />;
    const [lookups, projects, owners] = await Promise.all([leadLookups(db), activeProjects(db), assignableUsers(db, actor)]);
    return (
      <section className="space-y-6" aria-label="Add lead">
        <PageHeader
          as="h2"
          title="Add lead"
          description={
            actor.role === "agent"
              ? "The lead will be assigned to you."
              : `Choose an owner, or leave it empty to assign automatically among ${actor.role === "manager" ? "your teams' available agents" : "available agents"}. Returning customers go to their original agent.`
          }
          actions={
            <Link href="/dashboard/leads" className={buttonClasses({ variant: "secondary", size: "lg" })}>
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to list
            </Link>
          }
        />
        <LeadCreateForm
          lookups={lookups}
          projects={projects}
          // An admin may have an inactive project selected; new leads only go to active ones.
          defaultProjectId={projects.some((p) => p.id === projectId) ? projectId : (projects[0]?.id ?? "")}
          owners={owners}
          canChooseOwner={canDo(actor, "assign")}
        />
      </section>
    );
  });
}
