import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress";
import { formatInt } from "@/lib/format";
import type { LostBreakdown } from "../types";

/** FR-016: lost leads (created in the selected range and now Lost) by team; a team expands to its agents. */
export function LostLeads({ data }: { data: LostBreakdown | null }) {
  const maxTeam = Math.max(1, ...(data?.byTeam.map((t) => t.count) ?? [1]));

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Lost leads by team"
        badge={<Badge bordered={false}>Teams</Badge>}
        description="By the owner's team. Owners in several teams count under each; open a team to see its agents."
      />
      <div className="space-y-1.5 p-4">
        {!data ? (
          <EmptyState>No lead analytics for your role.</EmptyState>
        ) : data.byTeam.length === 0 ? (
          <EmptyState>No lost leads in this range.</EmptyState>
        ) : (
          data.byTeam.map((t) => (
            <details
              key={t.id}
              className="group rounded-xl border border-zinc-200/80 bg-white px-2.5 py-2 shadow-hairline"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChevronDown
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
                  />
                  <span className="truncate text-xs leading-4 font-bold text-zinc-900">
                    {t.label}
                  </span>
                </span>
                <span className="text-xs font-black tabular-nums">
                  {formatInt(t.count)}
                </span>
              </summary>
              <ProgressBar
                className="mt-2"
                size="xs"
                value={t.count}
                max={maxTeam}
                label={`${t.label} lost leads`}
              />
              <ul className="mt-2 space-y-1 border-t border-zinc-100 pt-2">
                {t.agents.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="truncate text-zinc-700">{a.label}</span>
                    <span className="font-bold tabular-nums">
                      {formatInt(a.count)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))
        )}
      </div>
    </Card>
  );
}
