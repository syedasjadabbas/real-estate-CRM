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
import { activeMeetingFilters, MEETING_FILTER_KEYS } from "@/features/meetings/url";
import { formatInt } from "@/lib/format";
import { canDoMeeting } from "@/modules/meetings/policy";
import { listMeetings, meetingCounts, meetingTeamOptions, organizerOptions } from "@/modules/meetings/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Meetings" };

/** Card link: applies exactly `want`, or clears it when that is what is already applied. */
function cardLink(base: string, params: Record<string, string>, want: Record<string, string>) {
  const active = MEETING_FILTER_KEYS.every((k) => (params[k] ?? "") === (want[k] ?? ""));
  return { active, href: active ? base : `${base}?${new URLSearchParams(want).toString()}` };
}

export default async function MeetingsPage({ searchParams }: PageProps<"/dashboard/meetings">) {
  const actor = await requirePageUser();
  if (!canDoMeeting(actor, "view")) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const db = getDb();
  const [result, organizers, counts, teams] = await Promise.all([listMeetings(db, actor, params), organizerOptions(db, actor), meetingCounts(db, actor), meetingTeamOptions(db, actor)]);
  const card = (want: Record<string, string>) => cardLink("/dashboard/meetings", params, want);
  const filters = activeMeetingFilters(params);

  return (
    <section className="space-y-6" aria-label="Meetings list">
      <PageHeader
        as="h2"
        title="Meetings"
        description="Site visits, office and online meetings with clients. Mark each one held or cancelled after it happens."
        actions={
          canDoMeeting(actor, "create") ? (
            <Link href="/dashboard/meetings/new" className={buttonClasses({ variant: "primary", size: "lg", className: "px-5" })}>
              <Plus aria-hidden="true" className="size-4" />
              Schedule meeting
            </Link>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Today" value={formatInt(counts.today)} caption="Meetings on today's date" {...card({ from: counts.date, to: counts.date })} />
        <MiniStat label="Scheduled ahead" value={formatInt(counts.ahead)} caption="From today onwards" {...card({ status: "scheduled", from: counts.date })} />
        <MiniStat label="Need an outcome" value={formatInt(counts.overdue)} caption="Time passed, still scheduled" className={counts.overdue ? "[&>p:nth-child(2)]:text-rose-700" : undefined} {...card({ overdue: "1" })} />
        <MiniStat label="Held this month" value={formatInt(counts.heldThisMonth)} caption="Marked completed" {...card({ status: "completed", from: counts.monthStart, to: counts.date })} />
      </div>
      <MeetingsToolbar params={params} total={result.total} organizers={organizers} teams={teams} />
      <MeetingsTable
        rows={result.rows}
        params={params}
        emptyMessage={filters || params.q ? "No meetings match. Try clearing filters or adjusting search." : "No meetings yet. Schedule one from here or from a lead."}
      />
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} params={params} />
    </section>
  );
}
