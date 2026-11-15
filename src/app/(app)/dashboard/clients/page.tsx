import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { RestrictedState } from "@/components/ui/empty-state";
import { ClientsTable } from "@/features/clients/components/clients-table";
import { ClientsToolbar } from "@/features/clients/components/clients-toolbar";
import { ClientsScopeNotice } from "@/features/clients/components/scope-notice";
import { clientsContext } from "@/features/clients/context";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams } from "@/features/leads/url";
import { canDoBooking } from "@/modules/bookings/policy";
import { selectableProjects } from "@/modules/projects/queries";
import { listClients } from "@/modules/clients/queries";
import { assignableUsers, leadLookups } from "@/modules/leads/queries";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: PageProps<"/dashboard/clients">) {
  const { actor, db, canView } = await clientsContext();
  if (!canView) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const [result, interestProjects, owners, lookups] = await Promise.all([
    listClients(db, actor, params),
    selectableProjects(db, actor),
    // The agent filter is for roles that see other agents' clients (agents see only their own).
    assignableUsers(db, actor),
    leadLookups(db),
  ]);
  const projects = canDoBooking(actor, "view") ? interestProjects : null;
  return (
    <section className="space-y-6" aria-label="All clients">
      <PageHeader
        as="h2"
        title="All clients"
        description={
          "Everyone who has enquired, across projects, with the projects they are interested in. Each new lead creates or joins the person's profile."
        }
      />
      <ClientsScopeNotice actor={actor} />
      <ClientsToolbar
        params={params}
        total={result.total}
        projects={projects}
        interestProjects={interestProjects}
        owners={owners.map((o) => ({ id: o.id, name: o.name }))}
        cities={lookups.cities.map((c) => ({ id: c.id, name: c.name }))}
      />
      <ClientsTable
        rows={result.rows}
        pathname="/dashboard/clients"
        params={params}
        now={result.generatedAt}
        emptyMessage={params.q || params.project ? "No clients match this search or filter." : "No clients yet."}
      />
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} params={params} />
    </section>
  );
}
