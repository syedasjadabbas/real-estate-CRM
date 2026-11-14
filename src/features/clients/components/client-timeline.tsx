import { Timeline, type TimelineActivity } from "@/features/leads/components/timeline";
import { formatDateTime } from "@/features/leads/format";
import { RELATIONSHIP_LABELS, type Relationship } from "@/modules/clients/constants";

function describeClient(a: TimelineActivity): { title: string; tag: string } {
  const d = (a.data ?? {}) as Record<string, unknown>;
  switch (a.type) {
    case "created":
      return {
        title:
          d.mode === "lead"
            ? `Client created from lead ${String(d.leadCode ?? "")}`
            : d.mode === "booking"
              ? `Client created on booking confirmation (lead ${String(d.leadCode ?? "")})`
              : "Client added manually",
        tag: "Created",
      };
    case "lead_linked":
      return { title: `Lead ${String(d.leadCode ?? "")} linked${d.bookingId ? " on booking confirmation" : ""}`, tag: "Lead" };
    case "note":
      return { title: "Note", tag: "Note" };
    case "update": {
      const fields = (d.fields as string[] | undefined) ?? [];
      if (d.nameFrom !== undefined) {
        const others = fields.filter((x) => x !== "name");
        return { title: `Name changed: ${String(d.nameFrom)} → ${String(d.nameTo)}${others.length ? ` (also ${others.join(", ")})` : ""}`, tag: "Update" };
      }
      return { title: `Details updated (${fields.join(", ") || "fields"})`, tag: "Update" };
    }
    case "assignment":
      return { title: "Reassigned", tag: "Assignment" };
    case "follow_up_scheduled":
      return { title: `Follow-up scheduled for ${formatDateTime(String(d.dueAt))}`, tag: "Follow-up" };
    case "follow_up_done":
      return { title: `Follow-up completed (was due ${formatDateTime(String(d.dueAt))})`, tag: "Follow-up" };
    case "file_uploaded":
      return { title: "Document uploaded", tag: "Document" };
    default:
      return { title: a.type, tag: "Activity" };
  }
}

/** Client history, newest first, in the Leads timeline style. */
export function ClientTimeline({ activities }: { activities: TimelineActivity[] }) {
  return <Timeline activities={activities} describe={describeClient} />;
}

export function relationshipLabel(value: Relationship | null) {
  return value ? RELATIONSHIP_LABELS[value] : "Not set";
}
