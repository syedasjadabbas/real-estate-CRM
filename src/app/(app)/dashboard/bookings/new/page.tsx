import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { BookingForm } from "@/features/bookings/components/booking-form";
import { canDoBooking } from "@/modules/bookings/policy";
import { bookingFormOptions } from "@/modules/bookings/queries";
import { activeProjects } from "@/modules/leads/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getProjectScope } from "@/server/project-scope";

export const metadata: Metadata = { title: "New booking" };

export default async function NewBookingPage({ searchParams }: PageProps<"/dashboard/bookings/new">) {
  const actor = await requirePageUser();
  if (!canDoBooking(actor, "create")) return <RestrictedState />;
  const db = getDb();
  const [{ project, lead }, projects, { activeProjectId }] = await Promise.all([searchParams, activeProjects(db), getProjectScope()]);
  const requested = typeof project === "string" ? project : activeProjectId;
  const projectId = projects.some((p) => p.id === requested) ? requested! : (projects[0]?.id ?? null);
  const options = projectId ? await bookingFormOptions(db, actor, projectId) : null;

  return (
    <section className="space-y-6" aria-label="New booking">
      <PageHeader
        as="h2"
        title="New booking"
        description="Creating a booking reserves the unit and moves the lead to Booking in Process."
        actions={
          <Link href="/dashboard/bookings" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to list
          </Link>
        }
      />
      {projectId && options ? (
        <BookingForm
          key={projectId}
          projectId={projectId}
          defaultLeadId={typeof lead === "string" ? lead : ""}
          options={{ projects, leads: options.leads, units: options.units }}
        />
      ) : (
        <EmptyState className="bg-white">No active project is available for bookings.</EmptyState>
      )}
    </section>
  );
}
