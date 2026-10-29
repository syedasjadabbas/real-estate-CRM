import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { UnitForm } from "@/features/inventory/components/unit-form";
import { EMPTY_UNIT } from "@/features/inventory/defaults";
import { canDoInventory } from "@/modules/inventory/policy";
import { inventoryProjects } from "@/modules/inventory/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getProjectScope } from "@/server/project-scope";

export const metadata: Metadata = { title: "Add unit" };

export default async function NewUnitPage({ searchParams }: PageProps<"/dashboard/inventory/new">) {
  const actor = await requirePageUser();
  if (!canDoInventory(actor, "manage")) return <RestrictedState />;
  const [{ project }, projects, { activeProjectId }] = await Promise.all([searchParams, inventoryProjects(getDb()), getProjectScope()]);
  const requested = typeof project === "string" ? project : activeProjectId;
  const projectId = projects.some((p) => p.id === requested) ? requested! : (projects[0]?.id ?? "");

  return (
    <section className="space-y-6" aria-label="Add unit">
      <PageHeader
        as="h2"
        title="Add unit"
        description="New units start as Available. Floor, block, category, type and premium follow the project's inventory dimensions."
        actions={
          <Link href="/dashboard/inventory" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to list
          </Link>
        }
      />
      {projects.length === 0 ? (
        <EmptyState className="bg-white">Add a project before adding units.</EmptyState>
      ) : (
        <UnitForm initial={{ ...EMPTY_UNIT, projectId }} projects={projects} />
      )}
    </section>
  );
}
