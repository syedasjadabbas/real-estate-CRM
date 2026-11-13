import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { ClientsTable } from "@/features/clients/components/clients-table";
import { ClientsToolbar } from "@/features/clients/components/clients-toolbar";
import { ClientsScopeNotice } from "@/features/clients/components/scope-notice";
import { clientsContext } from "@/features/clients/context";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams } from "@/features/leads/url";
import { canDoBooking } from "@/modules/bookings/policy";
import { canDoClient } from "@/modules/clients/policy";
import { selectableProjects } from "@/modules/projects/queries";
import { listClients } from "@/modules/clients/queries";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: PageProps<"/dashboard/clients">) {
  const { actor, db, canView } = await clientsContext();
  if (!canView) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const [result, projects] = await Promise.all([
    listClients(db, actor, params),
    canDoBooking(actor, "view") ? selectableProjects(db, actor) : Promise.resolve(null),
  ]);
  return (
    <section className="space-y-6" aria-label="All clients">
      <PageHeader
        as="h2"
        title="All clients"
        description={
          "Everyone who has enquired, across projects, with the projects they are interested in. Each new lead creates or joins the person's profile."
        }
        actions={
          canDoClient(actor, "createManual") ? (
            <Link href="/dashboard/clients/new" className={buttonClasses({ variant: "primary", size: "lg", className: "px-5" })}>
              <Plus aria-hidden="true" className="size-4" />
              Add client
            </Link>
          ) : null
        }
      />
      <ClientsScopeNotice actor={actor} />
      <ClientsToolbar params={params} total={result.total} projects={projects} />
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
