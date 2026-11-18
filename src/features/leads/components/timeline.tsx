import { EmptyState } from "@/components/ui/empty-state";
import { BUSINESS_TIME_ZONE, PRIORITY_LABELS, STAGE_LABELS, type LeadPriority, type LeadStage } from "@/modules/leads/constants";
import type { LeadDetail } from "@/modules/leads/queries";
import { formatClock } from "@/modules/recordings/validation";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { formatDateTime } from "../format";
import { PanelCard } from "./detail-panels";

type Activity = LeadDetail["activities"][number];
/** Any module's activity row (leads, clients). */
export type TimelineActivity = Omit<Activity, "type" | "actorRole"> & { type: string; actorRole?: string | null };

/** One labelled line under an entry: "Source: Facebook → Walk-in". */
export type TimelineDetail = { label: string; value: string };
export type TimelineDescription = { title: string; tag: string; details?: TimelineDetail[] };
type Context = { people: Record<string, string> };

/** Stored column → what a person calls it (older entries kept only column names). */
const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  phoneCountryCode: "Phone",
  phoneNumber: "Phone",
  phoneE164: "Phone",
  phones: "Other phone numbers",
  email: "Email",
  cityId: "City",
  cityOther: "City",
  gender: "Gender",
  sourceId: "Source",
  budgetRangeId: "Budget",
  desiredSize: "Desired size",
  priority: "Priority",
};

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const stage = (v: unknown) => STAGE_LABELS[v as LeadStage] ?? str(v) ?? "—";
const DAY = 86_400_000;

function lateness(dueAt: unknown, doneAt: Date | string) {
  const due = new Date(String(dueAt)).getTime();
  const done = new Date(doneAt).getTime();
  if (!Number.isFinite(due)) return null;
  const late = done - due;
  if (late <= 60 * 60_000) return "on time";
  return late < DAY ? `${Math.round(late / 3_600_000)} h late` : `${Math.round(late / DAY)} day${Math.round(late / DAY) === 1 ? "" : "s"} late`;
}

/** "3 years ago", "5 months ago", "2 days ago", "today". */
function ago(at: Date | string, asOf: Date | string) {
  const days = Math.floor((new Date(asOf).getTime() - new Date(at).getTime()) / DAY);
  if (days < 1) return "today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365.25);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

const monthKey = (at: Date | string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: BUSINESS_TIME_ZONE }).format(new Date(at));

function describeLead(a: TimelineActivity, { people }: Context): TimelineDescription {
  const d = (a.data ?? {}) as Record<string, unknown>;
  const person = (id: unknown) => (typeof id === "string" ? (people[id] ?? "a former user") : null);
  switch (a.type) {
    case "created": {
      const details: TimelineDetail[] = [];
      for (const [label, key] of [["Project", "project"], ["Source", "source"], ["Phone", "phone"], ["City", "city"], ["Budget", "budget"], ["Priority", "priority"]] as const) {
        const v = str(d[key]);
        if (v && !(key === "priority" && v === PRIORITY_LABELS["none" as LeadPriority])) details.push({ label, value: v });
      }
      if (d.duplicateOf) details.push({ label: "Duplicate of", value: `lead ${String(d.duplicateOf)}` });
      return { title: "Lead created", tag: "Created", details };
    }
    case "note":
      if (a.body?.startsWith("Call ·")) return { title: "Call logged", tag: "Call" };
      return { title: "Note added", tag: "Note" };
    case "stage_change": {
      const details: TimelineDetail[] = [{ label: "Stage", value: `${d.from ? `${stage(d.from)} → ` : ""}${stage(d.to)}` }];
      if (str(d.reason)) details.push({ label: d.to === "lost_lead" ? "Lost reason" : "Reason", value: String(d.reason) });
      return { title: `Moved to ${stage(d.to)}`, tag: "Stage", details };
    }
    case "follow_up_scheduled":
      return { title: "Follow-up scheduled", tag: "Follow-up", details: [{ label: "Due", value: formatDateTime(String(d.dueAt)) }] };
    case "follow_up_done": {
      const late = lateness(d.dueAt, a.createdAt);
      return { title: "Follow-up completed", tag: "Follow-up", details: [{ label: "Was due", value: `${formatDateTime(String(d.dueAt))}${late ? ` · done ${late}` : ""}` }] };
    }
    case "assignment": {
      const to = person(d.ownerId ?? d.to);
      const from = person(d.from);
      const details: TimelineDetail[] = [];
      if (to) details.push({ label: "Now with", value: to });
      if (from) details.push({ label: "Previously with", value: from });
      if (str(d.reason)) details.push({ label: "Why", value: String(d.reason) });
      const title =
        d.mode === "scored" || d.mode === "rotation"
          ? `Assigned automatically${to ? ` to ${to}` : ""}`
          : d.mode === "returning_customer"
            ? `Assigned to the customer's earlier agent${to ? `, ${to}` : ""}`
            : d.mode === "claim"
              ? `Claimed from the unassigned pool${to ? ` by ${to}` : ""}`
              : `Reassigned${to ? ` to ${to}` : ""}`;
      return { title, tag: "Assignment", details };
    }
    case "update": {
      const changes = d.changes as { field: string; from: string; to: string }[] | undefined;
      if (changes?.length) {
        return { title: `Details changed: ${changes.map((c) => c.field).join(", ")}`, tag: "Update", details: changes.map((c) => ({ label: c.field, value: `${c.from} → ${c.to}` })) };
      }
      // Older entries: the field names, and the name's old / new value when it changed.
      const fields = [...new Set(((d.fields as string[] | undefined) ?? []).map((f) => FIELD_LABELS[f] ?? f))];
      const details: TimelineDetail[] = d.nameFrom !== undefined ? [{ label: "Name", value: `${String(d.nameFrom)} → ${String(d.nameTo)}` }] : [];
      return { title: `Details changed: ${fields.join(", ") || "fields"}`, tag: "Update", details };
    }
    case "review":
      // Call reviews carry a 1–5 score (16 Nov 2026); a plain note or older review has none.
      return typeof d.rating === "number" ? { title: `Call review · ${d.rating}/5`, tag: "Call review" } : { title: "Note added", tag: "Note" };
    case "regenerated":
      return { title: "Customer enquired again (re-inquiry)", tag: "Re-inquiry", details: str(d.by) ? [{ label: "Recorded by", value: String(d.by) }] : [] };
    case "lost_requested":
      return { title: "Asked to mark the lead as lost", tag: "Lost request", details: str(d.reason) ? [{ label: "Lost reason", value: String(d.reason) }] : [] };
    case "lost_decided": {
      const details: TimelineDetail[] = [];
      if (d.approved && d.from && d.from !== "lost_lead") details.push({ label: "Stage", value: `${stage(d.from)} → ${STAGE_LABELS.lost_lead}` });
      if (str(d.reason)) details.push({ label: "Lost reason", value: String(d.reason) });
      return { title: d.approved ? "Lost request approved: lead closed as lost" : "Lost request rejected: lead stays open", tag: "Decision", details };
    }
    case "meeting": {
      const verb = d.action === "completed" ? "Meeting held" : d.action === "cancelled" ? "Meeting cancelled" : "Meeting scheduled";
      const details: TimelineDetail[] = [];
      if (str(d.title)) details.push({ label: "Meeting", value: String(d.title) });
      if (d.startsAt) details.push({ label: "When", value: formatDateTime(String(d.startsAt)) });
      return { title: verb, tag: "Meeting", details };
    }
    case "file_uploaded": {
      const details: TimelineDetail[] = a.body ? [{ label: "File", value: a.body }] : [];
      // WhatsApp screenshots (18 Nov 2026): a call counts as a call; a chat is proof of the conversation.
      if (d.kind === "whatsapp_call") {
        const len = typeof d.durationSec === "number" ? ` · ${formatClock(d.durationSec)}` : "";
        return { title: `WhatsApp call (screenshot)${len}`, tag: "Call", details };
      }
      if (d.kind === "whatsapp_chat") return { title: "WhatsApp chat screenshot added", tag: "WhatsApp", details };
      if (d.kind === "call_recording" && "durationSec" in d) details.push({ label: "Call length", value: d.durationSec === null ? "unknown (couldn't be read from the file)" : formatClock(Number(d.durationSec)) });
      const length = d.kind === "call_recording" && typeof d.durationSec === "number" ? ` · ${formatClock(d.durationSec)}` : "";
      return { title: `${d.kind === "document" ? "Document" : "Call recording"} uploaded${length}`, tag: d.kind === "document" ? "File" : "Call", details };
    }
    case "file_deleted":
      return { title: `${d.kind === "document" ? "Document" : "Call recording"} deleted`, tag: "File", details: a.body ? [{ label: "File", value: a.body }] : [] };
    case "client_linked":
      return {
        title: d.mode === "converted" ? "Converted to a client" : d.mode === "created" ? "Client profile created" : d.mode === "booking_created" ? "Client created from the confirmed booking" : "Linked to an existing client",
        tag: "Client",
      };
    case "verification":
      return {
        title: d.status === "approved" ? "Lead approved in verification" : d.status === "rejected" ? "Lead rejected in verification" : "Lead sent again for verification",
        tag: "Verification",
        details: str(d.note) ? [{ label: "Reason", value: String(d.note) }] : [],
      };
    default:
      return { title: a.type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), tag: "Activity" };
  }
}

/**
 * Lead history, newest first (FR-025), grouped by month. Each entry says what happened, the old and
 * new values, who did it (with their role) and how long ago, so a lead opened years later still
 * reads on its own (owner, 15 Nov 2026). Other modules pass their own `describe`.
 */
export function Timeline({
  activities,
  describe = describeLead,
  people = {},
  asOf,
}: {
  activities: TimelineActivity[];
  describe?: (a: TimelineActivity, ctx: Context) => TimelineDescription;
  people?: Record<string, string>;
  /** When the page was read; shows "2 years ago" beside each date. */
  asOf?: Date | string;
}) {
  const oldest = activities[activities.length - 1];
  const newest = activities[0];
  const groups: { month: string; items: TimelineActivity[] }[] = [];
  for (const a of activities) {
    const month = monthKey(a.createdAt);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.items.push(a);
    else groups.push({ month, items: [a] });
  }

  return (
    <PanelCard title={`Timeline · ${activities.length} ${activities.length === 1 ? "entry" : "entries"}`}>
      {activities.length === 0 ? (
        <EmptyState size="sm">No activity yet.</EmptyState>
      ) : (
        <div className="space-y-4">
          <p className="rounded-xl bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600">
            History from <span className="font-bold text-zinc-800">{formatDateTime(oldest.createdAt)}</span>
            {asOf ? ` (${ago(oldest.createdAt, asOf)})` : ""} to <span className="font-bold text-zinc-800">{formatDateTime(newest.createdAt)}</span>
            {asOf ? ` (${ago(newest.createdAt, asOf)})` : ""}. Newest first.
          </p>
          {groups.map((g) => (
            <section key={g.month} aria-label={g.month} className="space-y-2.5">
              <h4 className="text-[10px] font-black tracking-[0.15em] text-zinc-500 uppercase">{g.month}</h4>
              <ol className="space-y-2.5">
                {g.items.map((a) => {
                  const { title, tag, details = [] } = describe(a, { people });
                  const d = (a.data ?? {}) as Record<string, unknown>;
                  const role = a.actorRole ? ROLE_LABELS[a.actorRole as Role] : null;
                  return (
                    <li key={a.id} className="rounded-xl border border-zinc-200/80 px-3 py-2.5 shadow-hairline">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold">{title}</p>
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-black tracking-[0.05em] text-zinc-600 uppercase">{tag}</span>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        {formatDateTime(a.createdAt)}
                        {asOf ? ` · ${ago(a.createdAt, asOf)}` : ""} · {a.actorName ? `by ${a.actorName}${role ? ` (${role})` : ""}` : "Automatic (system)"}
                      </p>
                      {details.length ? (
                        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                          {details.map((x, i) => (
                            <div key={`${x.label}-${i}`} className="contents">
                              <dt className="font-semibold text-zinc-500">{x.label}</dt>
                              <dd className="min-w-0 break-words text-zinc-800">{x.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {a.type === "stage_change" && d.remarks ? <p className="mt-1.5 text-xs whitespace-pre-line text-zinc-800">“{String(d.remarks)}”</p> : null}
                      {a.body && a.type !== "file_uploaded" && a.type !== "file_deleted" ? <p className="mt-1.5 text-xs whitespace-pre-line text-zinc-800">{a.body}</p> : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </PanelCard>
  );
}
