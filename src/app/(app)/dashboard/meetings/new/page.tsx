import { ArrowLeft } from "lucide-react";
import { FreshForm } from "@/components/ui/fresh-form";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { MeetingForm } from "@/features/meetings/components/meeting-form";
import { canDoMeeting } from "@/modules/meetings/policy";
import { meetingFormOptions } from "@/modules/meetings/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getProjectScope } from "@/server/project-scope";

export const metadata: Metadata = { title: "Schedule meeting" };

export default async function NewMeetingPage({ searchParams }: PageProps<"/dashboard/meetings/new">) {
  const actor = await requirePageUser();
  if (!canDoMeeting(actor, "create")) return <RestrictedState />;
  const [{ lead }, { activeProjectId }] = await Promise.all([searchParams, getProjectScope()]);
  const leadId = typeof lead === "string" && /^[0-9a-f-]{36}$/i.test(lead) ? lead : null;
  const options = await meetingFormOptions(getDb(), actor, activeProjectId, leadId);
  const fromLead = leadId && options.leads.some((l) => l.id === leadId) ? leadId : "";

  return (
    <section className="space-y-6" aria-label="Schedule meeting">
      <PageHeader
        as="h2"
        title="Schedule meeting"
        description="Every meeting is linked to a lead. Scheduling counts as a touch on the lead and appears on its timeline."
        actions={
          <Link href={fromLead ? `/dashboard/leads/${fromLead}` : "/dashboard/meetings"} className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            {fromLead ? "Back to lead" : "Back to list"}
          </Link>
        }
      />
      <FreshForm>
        <MeetingForm
          mode="create"
          options={options}
          initial={{ title: "", startsLocal: "", endsLocal: "", type: "", location: "", organizerId: actor.id, leadId: fromLead, notes: "" }}
        />
      </FreshForm>
    </section>
  );
}
