import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { Pagination } from "@/features/leads/components/pagination";
import { SortLinks, type SortLinkColumn } from "@/features/leads/components/sort-links";
import { flattenParams } from "@/features/leads/url";
import { ProjectCard } from "@/features/projects/components/project-card";
import { ProjectsToolbar } from "@/features/projects/components/projects-toolbar";
import { formatInt } from "@/lib/format";
import type { ProjectSort } from "@/modules/projects/constants";
import { canDoProject } from "@/modules/projects/policy";
import { listProjects } from "@/modules/projects/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Projects" };

const SORT_COLUMNS: SortLinkColumn<ProjectSort>[] = [
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "developer", label: "Developer" },
  { key: "city", label: "City" },
  { key: "units", label: "Units tracked", firstDir: "desc" },
];

export default async function ProjectsPage({ searchParams }: PageProps<"/dashboard/projects">) {
  const actor = await requirePageUser();
  if (!canDoProject(actor, "view")) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const result = await listProjects(getDb(), actor, params);
  const filtered = Boolean(params.q || params.type || params.status);

  return (
    <section className="space-y-6" aria-label="All projects">
      {/* Reference KPI tiles: Projects · Units tracked · Project types */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniStat label="Projects" value={formatInt(result.kpis.projects)} caption="Buildings, farmhouses and societies" />
        <MiniStat label="Units tracked" value={formatInt(result.kpis.unitsTracked)} caption="Units across all projects" />
        <MiniStat label="Project types" value={formatInt(result.kpis.projectTypes)} caption="Distinct types in use" />
      </div>
      <PageHeader
        as="h2"
        title="All projects"
        description="Projects are company-wide. Inactive projects stay listed here but are hidden from the project selector for non-admins."
        actions={
          canDoProject(actor, "manage") ? (
            <Link href="/dashboard/projects/new" className={buttonClasses({ variant: "primary", size: "lg", className: "px-5" })}>
              <Plus aria-hidden="true" className="size-4" />
              Add project
            </Link>
          ) : null
        }
      />
      <ProjectsToolbar params={params} total={result.total} />
      <SortLinks path="/dashboard/projects" params={params} name="Sort projects" columns={SORT_COLUMNS} sort={result.query.sort} dir={result.query.dir} />
      {result.rows.length === 0 ? (
        <EmptyState className="bg-white">{filtered ? "No projects match these filters." : "No projects yet."}</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {result.rows.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} params={params} />
    </section>
  );
}
