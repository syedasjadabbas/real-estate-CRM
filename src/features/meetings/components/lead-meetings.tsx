import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/features/leads/format";
import { OverdueChip } from "@/features/tasks/components/task-pills";
import type { MeetingListRow } from "@/modules/meetings/queries";
import { MeetingStatusPill } from "./meeting-pills";

/** Compact list of a lead's meetings (lead page panel), within the viewer's meetings scope. */
export function LeadMeetingsList({ rows }: { rows: MeetingListRow[] }) {
  if (rows.length === 0) return <EmptyState size="sm">No meetings for this lead yet.</EmptyState>;
  return (
    <ul className="space-y-1.5">
      {rows.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
          <div className="min-w-0">
            <Link href={`/dashboard/meetings/${m.id}`} className="font-bold break-words hover:text-brand hover:underline">
              {m.title}
            </Link>
            <p className="text-[11px] text-zinc-500">
              {formatDateTime(m.startsAt)} · {m.organizerName}
            </p>
          </div>
          <span className="flex items-center gap-1.5">
            {m.overdue ? <OverdueChip /> : null}
            <MeetingStatusPill status={m.status} />
          </span>
        </li>
      ))}
    </ul>
  );
}
