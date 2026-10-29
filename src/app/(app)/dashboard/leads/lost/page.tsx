import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress";
import { ApprovalActions } from "@/features/leads/components/approval-actions";
import { StagePill } from "@/features/leads/components/chips";
import { LeadsListView } from "@/features/leads/components/list-view";
import { leadsContext } from "@/features/leads/context";
import { formatDateTime } from "@/features/leads/format";
import { formatInt } from "@/lib/format";
import { lostReasonMix, pendingLostRequests } from "@/modules/leads/queries";

export const metadata: Metadata = { title: "Lost leads" };

async function LostInsights() {
  const { actor, db, projectId, canView } = await leadsContext();
  if (!canView || !projectId) return null;
  const [mix, requests] = await Promise.all([lostReasonMix(db, actor, projectId), pendingLostRequests(db, actor, projectId)]);
  const max = Math.max(1, ...mix.map((m) => m.total));

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Card className="overflow-hidden">
        <CardHeader title="Lost reasons" badge={<Badge bordered={false}>Mix</Badge>} description="Why leads in your scope were lost" />
        <div className="space-y-1.5 p-4">
          {mix.length === 0 ? (
            <EmptyState size="sm">No lost leads yet.</EmptyState>
          ) : (
            mix.map((m) => (
              <div key={m.reason ?? "none"} className="rounded-xl border border-zinc-200/80 px-2.5 py-2 shadow-hairline">
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-zinc-900">{m.reason ?? "No reason recorded"}</span>
                  <span className="font-black tabular-nums">{formatInt(m.total)}</span>
                </div>
                <ProgressBar className="mt-2" size="xs" value={m.total} max={max} label={m.reason ?? "No reason"} />
              </div>
            ))
          )}
        </div>
      </Card>
      {requests.length > 0 || actor.role !== "agent" ? (
        <Card className="overflow-hidden">
          <CardHeader
            title="Approvals"
            badge={<Badge tone="amber">{requests.length} pending</Badge>}
            description="Lost requests from your team waiting for a decision"
          />
          <div className="space-y-2 p-4">
            {requests.length === 0 ? (
              <EmptyState size="sm">No lost requests waiting.</EmptyState>
            ) : (
              requests.map((r) => (
                <div key={r.id} className="space-y-2 rounded-xl border border-zinc-200/80 p-3 shadow-hairline">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <Link href={`/dashboard/leads/${r.leadId}`} className="font-bold hover:text-brand hover:underline">
                      {r.leadName} <span className="font-semibold tracking-[0.05em] text-zinc-500">{r.leadCode}</span>
                    </Link>
                    <StagePill stage={r.stage} />
                  </div>
                  <p className="text-xs text-zinc-600">
                    <span className="font-bold text-zinc-800">{r.reason ?? "No reason"}</span> · requested by {r.requesterName} ·{" "}
                    {formatDateTime(r.createdAt)}
                    {r.note ? <span className="block text-zinc-700">“{r.note}”</span> : null}
                  </p>
                  <ApprovalActions approvalId={r.id} />
                </div>
              ))
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export default function LostLeadsPage({ searchParams }: PageProps<"/dashboard/leads/lost">) {
  return (
    <LeadsListView
      view="lost"
      title="Lost leads"
      description="Review lost leads and lost-reason mix. Managers and admins approve team lost requests here."
      pathname="/dashboard/leads/lost"
      searchParams={searchParams}
      emptyMessage="No lost leads."
      before={<LostInsights />}
    />
  );
}
