import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { BookingsTable } from "@/features/bookings/components/bookings-table";
import { BookingsToolbar } from "@/features/bookings/components/bookings-toolbar";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams } from "@/features/leads/url";
import { canDoBooking } from "@/modules/bookings/policy";
import { listBookings } from "@/modules/bookings/queries";
import { businessToday } from "@/modules/bookings/today";
import { inventoryProjects } from "@/modules/inventory/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getProjectScope } from "@/server/project-scope";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage({ searchParams }: PageProps<"/dashboard/bookings">) {
  const actor = await requirePageUser();
  if (!canDoBooking(actor, "view")) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const db = getDb();
  const [{ activeProjectId }, projects] = await Promise.all([getProjectScope(), inventoryProjects(db)]);
  const result = await listBookings(db, actor, params, activeProjectId, businessToday());
  const filtered = Boolean(params.q || params.stage);

  return (
    <section className="space-y-6" aria-label="Bookings list">
      <PageHeader
        as="h2"
        title="All bookings"
        description="Paid is the sum of payments posted by Finance, minus approved reversals."
        actions={
          canDoBooking(actor, "create") ? (
            <Link
              href={`/dashboard/bookings/new${result.projectId ? `?project=${result.projectId}` : ""}`}
              className={buttonClasses({ variant: "primary", size: "lg", className: "px-5" })}
            >
              <Plus aria-hidden="true" className="size-4" />
              New booking
            </Link>
          ) : null
        }
      />
      <BookingsToolbar params={params} total={result.total} projects={projects} projectId={result.projectId} />
      <BookingsTable rows={result.rows} emptyMessage={filtered ? "No bookings match these filters." : "No bookings in this scope yet."} />
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} params={params} />
    </section>
  );
}
