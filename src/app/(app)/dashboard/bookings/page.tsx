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
import { bookingFilterOptions, bookingStageCounts, listBookings } from "@/modules/bookings/queries";
import { BOOKING_STAGE_LABELS } from "@/modules/bookings/constants";
import { MiniStat } from "@/components/ui/stat";
import { formatPrice } from "@/features/inventory/format";
import { withParams } from "@/features/leads/url";
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
  const [result, options] = await Promise.all([listBookings(db, actor, params, activeProjectId, businessToday()), bookingFilterOptions(db, actor)]);
  const stages = await bookingStageCounts(db, actor, result.projectId);
  const filtered = Boolean(params.q || params.stage || params.agent || params.team || params.from || params.to);

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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {stages.map((s) => {
          const on = params.stage === s.stage;
          return (
            <MiniStat
              key={s.stage}
              label={BOOKING_STAGE_LABELS[s.stage]}
              value={String(s.n)}
              caption={s.n ? formatPrice(s.value) : "None"}
              href={withParams("/dashboard/bookings", params, { stage: on ? null : s.stage, page: null })}
              active={on}
            />
          );
        })}
      </div>
      <BookingsToolbar params={params} total={result.total} projects={projects} projectId={result.projectId} agents={options.agents} teams={options.teams} />
      <BookingsTable rows={result.rows} params={params} emptyMessage={filtered ? "No bookings match these filters." : "No bookings in this scope yet."} />
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} params={params} />
    </section>
  );
}
