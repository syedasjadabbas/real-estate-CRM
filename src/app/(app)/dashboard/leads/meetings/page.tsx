import type { Metadata } from "next";
import { LeadsListView } from "@/features/leads/components/list-view";

export const metadata: Metadata = { title: "Meetings scheduled" };

export default function MeetingsScheduledPage({ searchParams }: PageProps<"/dashboard/leads/meetings">) {
  return <LeadsListView view="meetings" title="Meetings scheduled" description="Leads with an upcoming meeting, or at the Meeting Scheduled stage." pathname="/dashboard/leads/meetings" searchParams={searchParams} emptyMessage="No leads here right now." />;
}
