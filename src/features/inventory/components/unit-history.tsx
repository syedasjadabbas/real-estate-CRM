import { EmptyState } from "@/components/ui/empty-state";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { UNIT_STATUS_LABELS, type UnitStatus } from "@/modules/inventory/constants";
import type { UnitDetail } from "@/modules/inventory/queries";

type Entry = UnitDetail["history"][number];

function describe(e: Entry): { title: string; tag: string; body?: string } {
  const before = (e.before ?? {}) as Record<string, unknown>;
  const after = (e.after ?? {}) as Record<string, unknown>;
  switch (e.action) {
    case "unit.create":
      return { title: "Unit added", tag: "Created" };
    case "unit.update":
      return { title: `Details updated (${Object.keys(after).join(", ")})`, tag: "Update" };
    case "unit.status": {
      const from = UNIT_STATUS_LABELS[before.status as UnitStatus] ?? String(before.status);
      const to = UNIT_STATUS_LABELS[after.status as UnitStatus] ?? String(after.status);
      return {
        title: `Status ${from} → ${to}`,
        tag: after.source === "booking" ? "Booking" : "Override",
        body: after.reason ? String(after.reason) : undefined,
      };
    }
    default:
      return { title: e.action, tag: "Activity" };
  }
}

/** Unit history from the audit log (edits and status changes), in the Leads timeline style. */
export function UnitHistory({ history }: { history: Entry[] }) {
  return (
    <PanelCard title={`History · ${history.length} recent`}>
      {history.length === 0 ? (
        <EmptyState size="sm">No history yet.</EmptyState>
      ) : (
        <ol className="space-y-2.5">
          {history.map((e) => {
            const { title, tag, body } = describe(e);
            return (
              <li key={e.id} className="rounded-xl border border-zinc-200/80 px-3 py-2.5 shadow-hairline">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold">{title}</p>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-black tracking-[0.05em] text-zinc-600 uppercase">{tag}</span>
                </div>
                <p className="text-[11px] text-zinc-500">
                  {formatDateTime(e.createdAt)} · {e.actorName ?? "System"}
                </p>
                {body ? <p className="mt-1.5 text-xs whitespace-pre-line text-zinc-800">{body}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
    </PanelCard>
  );
}
