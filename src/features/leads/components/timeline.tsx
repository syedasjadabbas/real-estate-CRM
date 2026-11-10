import { EmptyState } from "@/components/ui/empty-state";
import { STAGE_LABELS, type LeadStage } from "@/modules/leads/constants";
import type { LeadDetail } from "@/modules/leads/queries";
import { formatDateTime } from "../format";
import { PanelCard } from "./detail-panels";

type Activity = LeadDetail["activities"][number];
/** Any module's activity row (leads, clients). */
export type TimelineActivity = Omit<Activity, "type"> & { type: string };

function describeLead(a: TimelineActivity): { title: string; tag: string } {
  const d = (a.data ?? {}) as Record<string, unknown>;
  switch (a.type) {
    case "created":
      return { title: d.duplicateOf ? `Lead created (duplicate of ${String(d.duplicateOf)})` : "Lead created", tag: "Created" };
    case "note":
      return { title: "Note", tag: "Note" };
    case "stage_change":
      return {
        title: `Stage changed to ${STAGE_LABELS[d.to as LeadStage] ?? String(d.to)}${d.reason ? ` · ${String(d.reason)}` : ""}`,
        tag: "Stage change",
      };
    case "follow_up_scheduled":
      return { title: `Follow-up scheduled for ${formatDateTime(String(d.dueAt))}`, tag: "Follow-up" };
    case "follow_up_done":
      return { title: `Follow-up completed (was due ${formatDateTime(String(d.dueAt))})`, tag: "Follow-up" };
    case "assignment":
      return {
        title:
          d.mode === "scored" || d.mode === "rotation"
            ? `Auto-assigned${d.reason ? ` · ${String(d.reason)}` : ""}`
            : d.mode === "returning_customer"
              ? "Assigned to the customer's original agent"
              : d.mode === "claim"
                ? "Claimed from the unassigned pool"
                : "Reassigned",
        tag: "Assignment",
      };
    case "update":
      return { title: `Details updated (${(d.fields as string[] | undefined)?.join(", ") ?? "fields"})`, tag: "Update" };
    case "review":
      return { title: "Manager review", tag: "Review" };
    case "regenerated":
      return { title: "Re-inquiry received (regenerated)", tag: "Regenerated" };
    case "lost_requested":
      return { title: `Lost requested${d.reason ? ` · ${String(d.reason)}` : ""}`, tag: "Lost request" };
    case "lost_decided":
      return { title: d.approved ? "Lost request approved" : "Lost request rejected", tag: "Decision" };
    case "meeting": {
      const verb = d.action === "completed" ? "Meeting completed" : d.action === "cancelled" ? "Meeting cancelled" : "Meeting scheduled";
      return { title: `${verb}: ${String(d.title ?? "")}${d.startsAt ? ` · ${formatDateTime(String(d.startsAt))}` : ""}`, tag: "Meeting" };
    }
    case "file_uploaded":
      return { title: `${d.kind === "document" ? "Document" : "Call recording"} uploaded${a.body ? `: ${a.body}` : ""}`, tag: "File" };
    case "file_deleted":
      return { title: `${d.kind === "document" ? "Document" : "Call recording"} deleted${a.body ? `: ${a.body}` : ""}`, tag: "File" };
    case "client_linked":
      return {
        title: d.mode === "converted" ? "Converted to a client" : d.mode === "booking_created" ? "Client created from the confirmed booking" : "Linked to an existing client",
        tag: "Client",
      };
    default:
      return { title: a.type, tag: "Activity" };
  }
}

/** Lead history, newest first (FR-025). Other modules pass their own `describe`. */
export function Timeline({
  activities,
  describe = describeLead,
}: {
  activities: TimelineActivity[];
  describe?: (a: TimelineActivity) => { title: string; tag: string };
}) {
  return (
    <PanelCard title={`Timeline · ${activities.length} ${activities.length === 1 ? "entry" : "entries"}`}>
      {activities.length === 0 ? (
        <EmptyState size="sm">No activity yet.</EmptyState>
      ) : (
        <ol className="space-y-2.5">
          {activities.map((a) => {
            const { title, tag } = describe(a);
            const d = (a.data ?? {}) as Record<string, unknown>;
            return (
              <li key={a.id} className="rounded-xl border border-zinc-200/80 px-3 py-2.5 shadow-hairline">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold">{title}</p>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-black tracking-[0.05em] text-zinc-600 uppercase">{tag}</span>
                </div>
                <p className="text-[11px] text-zinc-500">
                  {formatDateTime(a.createdAt)} · {a.actorName ?? "System"}
                </p>
                {a.type === "stage_change" && d.from ? (
                  <p className="mt-1 text-[11px] font-semibold text-zinc-600">
                    {STAGE_LABELS[d.from as LeadStage]} → {STAGE_LABELS[d.to as LeadStage]}
                  </p>
                ) : null}
                {a.body ? <p className="mt-1.5 text-xs whitespace-pre-line text-zinc-800">{a.body}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
    </PanelCard>
  );
}
