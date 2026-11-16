import type { Metadata } from "next";
import { Phone } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { withLeadsAccess } from "@/features/leads/components/list-view";
import { VerifyActions } from "@/features/leads/components/verification";
import { formatDateTime } from "@/features/leads/format";
import { telHref } from "@/modules/leads/phone";
import { canVerifyLeads, pendingVerification } from "@/modules/leads/verification";
import { MaskedPhone } from "@/components/ui/masked-phone";

export const metadata: Metadata = { title: "Verify leads" };

/** Leads agents added by hand, waiting for an Admin or Super Admin to approve or reject them. */
export default function VerifyLeadsPage() {
  return withLeadsAccess(async ({ actor, db, projectId }) => {
    if (!canVerifyLeads(actor)) return <RestrictedState />;
    const rows = await pendingVerification(db, actor, projectId);
    return (
      <section className="space-y-6" aria-label="Verify leads">
        <PageHeader
          as="h2"
          title="Verify leads"
          description="Leads agents added by hand. The agent can work on a lead once you approve it; a rejected lead goes back to the agent with your reason."
        />
        {rows.length === 0 ? (
          <EmptyState>No leads waiting for verification in this project.</EmptyState>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/dashboard/leads/${r.id}`} className="text-sm font-bold hover:text-brand hover:underline">
                    {r.name} <span className="text-xs font-semibold tracking-[0.05em] text-zinc-500">{r.code}</span>
                  </Link>
                  <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-700">
                    <a href={telHref(r.phoneCountryCode, r.phoneNumber)} aria-label={`Call ${r.name}`} title={`Call ${r.name}`} className="inline-flex size-6 items-center justify-center rounded-full bg-brand-50 text-brand ring-1 ring-brand/20 hover:bg-brand hover:text-white">
                      <Phone aria-hidden="true" className="size-3" />
                    </a>
                    <MaskedPhone phone={r.phone} name={r.name} />
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Added by {r.ownerName ?? "an agent"} · {formatDateTime(r.createdAt)}
                </p>
                <VerifyActions leadId={r.id} />
              </Card>
            ))}
          </div>
        )}
      </section>
    );
  });
}
