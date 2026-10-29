import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StagePill } from "@/features/leads/components/chips";
import { ScopeNotice, withLeadsAccess } from "@/features/leads/components/list-view";
import { formatDateTime } from "@/features/leads/format";
import { reviewsFeed } from "@/modules/leads/queries";

export const metadata: Metadata = { title: "Lead reviews" };

export default function ReviewsPage() {
  return withLeadsAccess(async ({ actor, db, projectId }) => {
    const reviews = await reviewsFeed(db, actor, projectId);
    return (
      <section className="space-y-6" aria-label="Reviews">
        <PageHeader
          as="h2"
          title="Reviews"
          description={actor.role === "agent" ? "Reviews on leads assigned to you." : "Manager reviews on leads in your scope."}
        />
        <ScopeNotice actor={actor} />
        {reviews.length === 0 ? (
          <EmptyState>No reviews found. Manager reviews for leads in this scope will appear here.</EmptyState>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/dashboard/leads/${r.leadId}`} className="text-sm font-bold hover:text-brand hover:underline">
                    {r.leadName} <span className="text-xs font-semibold tracking-[0.05em] text-zinc-500">{r.leadCode}</span>
                  </Link>
                  <StagePill stage={r.stage} />
                </div>
                <p className="mt-2 text-sm whitespace-pre-line text-zinc-800">{r.body}</p>
                <p className="mt-2 text-[11px] text-zinc-500">
                  {r.reviewerName} · {formatDateTime(r.createdAt)}
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>
    );
  });
}
