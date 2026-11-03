import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { UnitImport } from "@/features/inventory/components/unit-import";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { canDoInventory } from "@/modules/inventory/policy";
import { inventoryProjects } from "@/modules/inventory/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getProjectScope } from "@/server/project-scope";

export const metadata: Metadata = { title: "Import units" };

/** FR-075 bulk unit import (super admin, admin). */
export default async function ImportUnitsPage() {
  const actor = await requirePageUser();
  if (!canDoInventory(actor, "manage")) return <RestrictedState />;
  const [projects, { activeProjectId }] = await Promise.all([inventoryProjects(getDb()), getProjectScope()]);
  const projectId = projects.some((p) => p.id === activeProjectId) ? activeProjectId! : (projects[0]?.id ?? "");
  return (
    <section className="space-y-6" aria-label="Import units">
      <PageHeader
        as="h2"
        title="Import units"
        description="Check a CSV file first: the validation report lists every row. Importing adds all rows or none, and new units start as Available."
        actions={
          <Link href="/dashboard/inventory" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to list
          </Link>
        }
      />
      {projects.length === 0 ? (
        <EmptyState className="bg-white">Add a project before importing units.</EmptyState>
      ) : (
        <PanelCard title="CSV file">
          <UnitImport projects={projects.map((p) => ({ id: p.id, label: p.label }))} projectId={projectId} />
        </PanelCard>
      )}
    </section>
  );
}
