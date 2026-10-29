import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { StagePill } from "@/features/leads/components/chips";
import { ScopeNotice, withLeadsAccess } from "@/features/leads/components/list-view";
import { formatDateTime } from "@/features/leads/format";
import { sharedPhoneGroups } from "@/modules/leads/queries";

export const metadata: Metadata = { title: "Shared phone numbers" };

export default function SharedPhonesPage() {
  return withLeadsAccess(async ({ actor, db, projectId }) => {
    const groups = await sharedPhoneGroups(db, actor, projectId);
    const involved = groups.reduce((sum, g) => sum + g.leads.length, 0);
    return (
      <section className="space-y-6" aria-label="Shared phone numbers">
        <PageHeader
          as="h2"
          title="Shared phone numbers"
          description="Non-duplicate leads that share the same country code and phone. Review multi-lead-per-phone cases."
        />
        <ScopeNotice actor={actor} />
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
          <MiniStat label="Phone groups" value={groups.length} caption="Shared numbers" />
          <MiniStat label="Leads involved" value={involved} caption="Across groups" />
        </div>
        {groups.length === 0 ? (
          <EmptyState>No shared phone numbers in this scope.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
            {groups.map((g) => (
              <Card key={g.phoneE164} className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
                  <p className="text-sm font-black">{g.phone}</p>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-black tracking-[0.05em] text-amber-700 uppercase">
                    {g.leads.length} leads
                  </span>
                </div>
                <ul className="divide-y divide-zinc-100">
                  {g.leads.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
                      <Link href={`/dashboard/leads/${l.id}`} className="font-bold hover:text-brand hover:underline">
                        {l.name} <span className="font-semibold tracking-[0.05em] text-zinc-500">{l.code}</span>
                      </Link>
                      <span className="flex items-center gap-2 text-zinc-600">
                        {l.ownerName ?? "Unassigned"} · {formatDateTime(l.createdAt)}
                        <StagePill stage={l.stage} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
        <p className="text-xs text-zinc-500">Merging leads is planned for a later release; reassign from each lead&apos;s page.</p>
      </section>
    );
  });
}
