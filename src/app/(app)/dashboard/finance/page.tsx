import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { PaymentsTable } from "@/features/finance/components/payments-table";
import { PaymentsToolbar } from "@/features/finance/components/payments-toolbar";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams } from "@/features/leads/url";
import { canDoFinance } from "@/modules/finance/policy";
import { listPaymentMethods, listPayments } from "@/modules/finance/queries";
import { inventoryProjects } from "@/modules/inventory/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Finance · Payments" };

export default async function FinancePaymentsPage({ searchParams }: PageProps<"/dashboard/finance">) {
  const actor = await requirePageUser();
  if (!canDoFinance(actor, "viewAll")) {
    // Managers only decide reversals for their team; everyone else has no Finance access.
    if (canDoFinance(actor, "decideReversal")) redirect("/dashboard/finance/approvals");
    return <RestrictedState />;
  }
  const params = flattenParams(await searchParams);
  const db = getDb();
  const [result, projects, methods] = await Promise.all([listPayments(db, actor, params), inventoryProjects(db), listPaymentMethods(db)]);
  const filtered = ["q", "project", "type", "kind", "from", "to"].some((k) => params[k]);

  return (
    <section className="space-y-6" aria-label="Payments">
      <PageHeader
        as="h2"
        title="Payments"
        description="Posted booking payments and approved reversals. Entries are never edited or deleted."
        actions={
          canDoFinance(actor, "record") ? (
            <Link href="/dashboard/finance/record" className={buttonClasses({ variant: "primary", size: "lg", className: "px-5" })}>
              <Plus aria-hidden="true" className="size-4" />
              Record payment
            </Link>
          ) : null
        }
      />
      <PaymentsToolbar params={params} total={result.total} projects={projects} methods={methods.map((m) => ({ id: m.id, name: m.name }))} />
      <PaymentsTable rows={result.rows} emptyMessage={filtered ? "No payments match these filters." : "No payments have been posted yet."} />
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} params={params} />
    </section>
  );
}
