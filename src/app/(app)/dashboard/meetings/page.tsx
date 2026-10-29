import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams } from "@/features/leads/url";
import { MeetingsTable } from "@/features/meetings/components/meetings-table";
import { MeetingsToolbar } from "@/features/meetings/components/meetings-toolbar";
import { activeMeetingFilters } from "@/features/meetings/url";
import { formatInt } from "@/lib/format";
import { canDoMeeting } from "@/modules/meetings/policy";
import { listMeetings, organizerOptions } from "@/modules/meetings/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Meetings" };

export default async function MeetingsPage({ searchParams }: PageProps<"/dashboard/meetings">) {
  const actor = await requirePageUser();
  if (!canDoMeeting(actor, "view")) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const db = getDb();
  const [result, organizers] = await Promise.all([listMeetings(db, actor, params), organizerOptions(db, actor)]);
  const filters = activeMeetingFilters(params);

  return (
    <section className="space-y-6" aria-label="Meetings list">
      <PageHeader
        as="h2"
        title="Meetings"
        description="All meetings you can access"
        actions={
          canDoMeeting(actor, "create") ? (
            <Link href="/dashboard/meetings/new" className={buttonClasses({ variant: "primary", size: "lg", className: "px-5" })}>
              <Plus aria-hidden="true" className="size-4" />
              Schedule meeting
            </Link>
          ) : null
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniStat label="Total meetings" value={formatInt(result.total)} caption={filters || params.q ? "Matching filters" : "All accessible"} />
        <MiniStat label="Active filters" value={formatInt(filters)} caption={filters ? "Filters applied" : "No filters"} />
        <MiniStat label="On this page" value={formatInt(result.rows.length)} caption="Loaded rows" />
      </div>
      <MeetingsToolbar params={params} total={result.total} organizers={organizers} />
      <MeetingsTable
        rows={result.rows}
        params={params}
        emptyMessage={filters || params.q ? "No meetings match. Try clearing filters or adjusting search." : "No meetings yet. Schedule one from here or from a lead."}
      />
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} params={params} />
    </section>
  );
}
