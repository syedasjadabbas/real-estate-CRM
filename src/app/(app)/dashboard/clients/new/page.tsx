import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { ClientCreateForm } from "@/features/clients/components/client-create-form";
import { clientsContext } from "@/features/clients/context";
import { canDoClient } from "@/modules/clients/policy";
import { assignableUsers, leadLookups } from "@/modules/leads/queries";

export const metadata: Metadata = { title: "Add client" };

export default async function NewClientPage() {
  const { actor, db } = await clientsContext();
  if (!canDoClient(actor, "createManual")) return <RestrictedState />;
  const [lookups, owners] = await Promise.all([leadLookups(db), assignableUsers(db, actor)]);
  return (
    <section className="space-y-6" aria-label="Add client">
      <PageHeader
        as="h2"
        title="Add client"
        description="Manual client profile. To turn a lead into a client, use Convert to client on the lead's page."
        actions={
          <Link href="/dashboard/clients" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to list
          </Link>
        }
      />
      <ClientCreateForm cities={lookups.cities} owners={owners} defaultOwnerId={owners[0]?.id ?? ""} />
    </section>
  );
}
