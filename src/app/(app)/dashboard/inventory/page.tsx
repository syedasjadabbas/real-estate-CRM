import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { InventoryToolbar } from "@/features/inventory/components/inventory-toolbar";
import { UnitsTable } from "@/features/inventory/components/units-table";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams } from "@/features/leads/url";
import { canDoInventory } from "@/modules/inventory/policy";
import { inventoryProjects, listUnits } from "@/modules/inventory/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getProjectScope } from "@/server/project-scope";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: PageProps<"/dashboard/inventory">) {
  const actor = await requirePageUser();
  if (!canDoInventory(actor, "view")) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const db = getDb();
  const [{ activeProjectId }, projects] = await Promise.all([getProjectScope(), inventoryProjects(db)]);
  const result = await listUnits(db, actor, params, activeProjectId);
  const filtered = Boolean(params.q || params.status || params.saleModel || params.nature);
  const scopeName = result.projectId ? (projects.find((p) => p.id === result.projectId)?.name ?? "this project") : "all projects";

  return (
    <section className="space-y-6" aria-label="Units">
      <PageHeader
        as="h2"
        title="Units"
        description={`Units for sale in ${scopeName}. Open a unit for its full dimensions and details.`}
        actions={
          canDoInventory(actor, "manage") && projects.length ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/inventory/import" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                Import CSV
              </Link>
              <Link
                href={`/dashboard/inventory/new${result.projectId ? `?project=${result.projectId}` : ""}`}
                className={buttonClasses({ variant: "primary", size: "lg", className: "px-5" })}
              >
                <Plus aria-hidden="true" className="size-4" />
                Add unit
              </Link>
            </div>
          ) : null
        }
      />
      <InventoryToolbar params={params} total={result.total} projects={projects} projectId={result.projectId} natures={result.natures} />
      <UnitsTable
        rows={result.rows}
        offset={(result.page - 1) * result.pageSize}
        emptyMessage={filtered ? "No units match these filters." : "No units in this scope yet."}
        params={params}
        sort={result.query.sort}
        dir={result.query.dir}
      />
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} params={params} />
    </section>
  );
}
