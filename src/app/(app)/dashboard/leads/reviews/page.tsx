import type { Metadata } from "next";
import { Headphones, MessageSquareText, Star } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StagePill } from "@/features/leads/components/chips";
import { RatingStars } from "@/features/leads/components/rating-stars";
import { ScopeNotice, withLeadsAccess } from "@/features/leads/components/list-view";
import { formatDateTime } from "@/features/leads/format";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams, withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { reviewsFeed } from "@/modules/leads/queries";
import { canPlayRecordings } from "@/modules/recordings/service";
import { formatClock } from "@/modules/recordings/validation";
import { ROLE_LABELS } from "@/server/auth/types";

export const metadata: Metadata = { title: "Lead reviews" };

const PATH = "/dashboard/leads/reviews";
const field = "h-9 rounded-xl border border-zinc-200/80 bg-white px-2.5 text-xs font-semibold shadow-hairline";

function Stat({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl leading-8 font-black tabular-nums">{value}</p>
      {children}
    </Card>
  );
}

/** Call reviews and notes, with the score, whose call it was and the recording (client, 25 Nov 2026). */
export default function ReviewsPage({ searchParams }: PageProps<"/dashboard/leads/reviews">) {
  return withLeadsAccess(async ({ actor, db, projectId }) => {
    const params = flattenParams(await searchParams);
    const { rows: reviews, page, pageCount, total, query, agents, stats, byStar } = await reviewsFeed(db, actor, projectId, params);
    const playable = canPlayRecordings(actor);
    const filtered = Boolean(query.q || query.rating || query.kind || query.agent);
    const most = Math.max(1, ...Object.values(byStar));
    return (
      <section className="space-y-6" aria-label="Reviews">
        <PageHeader
          as="h2"
          title="Call reviews & notes"
          description={actor.role === "agent" ? "Notes and reviews on leads assigned to you, yours and your Admins'." : "Notes and reviews written by agents and Admins on leads in your scope, newest first."}
        />
        <ScopeNotice actor={actor} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Call reviews" value={formatInt(stats.calls)}>
            <p className="text-xs text-zinc-600">{formatInt(stats.all - stats.calls)} notes</p>
          </Stat>
          <Stat label="Average score" value={stats.average === null ? "—" : `${stats.average}/5`}>
            <p className="text-xs text-zinc-600">{formatInt(stats.scored)} scored</p>
          </Stat>
          <Card className="p-4">
            <p className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Scores</p>
            <ul className="mt-1.5 space-y-1">
              {[5, 4, 3, 2, 1].map((n) => {
                const on = query.rating === n;
                return (
                  <li key={n}>
                    <Link href={withParams(PATH, params, { rating: on ? null : String(n), page: null })} aria-current={on ? "true" : undefined} className={cn("grid grid-cols-[28px_minmax(0,1fr)_24px] items-center gap-2 rounded-lg px-1 text-[11px] font-bold hover:bg-zinc-100", on && "bg-amber-50")}>
                      <span className="inline-flex items-center gap-0.5">
                        {n}
                        <Star aria-hidden="true" className="size-3 fill-amber-400 text-amber-400" />
                      </span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
                        <span className="block h-full rounded-full bg-amber-400" style={{ width: `${((byStar[n] ?? 0) / most) * 100}%` }} />
                      </span>
                      <span className="text-right tabular-nums">{formatInt(byStar[n] ?? 0)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <form method="get" action={PATH} className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-hairline" aria-label="Filter reviews">
          <input type="search" name="q" aria-label="Search reviews" defaultValue={query.q ?? ""} placeholder="Customer, code, reviewer or words" maxLength={100} className={cn(field, "min-w-0 flex-1 basis-56")} />
          <select name="kind" aria-label="Type" defaultValue={query.kind ?? ""} className={field}>
            <option value="">Reviews and notes</option>
            <option value="call">Call reviews</option>
            <option value="note">Notes</option>
          </select>
          {agents.length > 1 ? (
            <select name="agent" aria-label="Agent" defaultValue={query.agent ?? ""} className={field}>
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : null}
          {query.rating ? <input type="hidden" name="rating" value={query.rating} /> : null}
          <Button type="submit" variant="primary">
            Apply
          </Button>
          {filtered ? (
            <Link href={PATH} className={buttonClasses({ variant: "secondary" })}>
              Clear
            </Link>
          ) : null}
        </form>

        {reviews.length === 0 ? (
          <EmptyState>{filtered ? "Nothing matches these filters." : "No notes or reviews yet. Notes and reviews added on a lead's page appear here."}</EmptyState>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => {
              const call = r.rating !== null || r.recordingId !== null;
              const Icon = call ? Headphones : MessageSquareText;
              return (
                <Card key={r.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl", call ? "bg-amber-50 text-amber-700" : "bg-zinc-100 text-zinc-600")}>
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={`/dashboard/leads/${r.leadId}`} className="text-sm font-bold hover:text-brand hover:underline">
                          {r.leadName} <span className="text-xs font-semibold tracking-[0.05em] text-zinc-500">{r.leadCode}</span>
                        </Link>
                        <span className="flex items-center gap-2">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black uppercase", call ? "bg-amber-50 text-amber-800" : "bg-zinc-100 text-zinc-600")}>{call ? "Call review" : "Note"}</span>
                          <StagePill stage={r.stage} />
                        </span>
                      </div>
                      {r.rating !== null ? <RatingStars rating={r.rating} /> : null}
                      <p className="text-sm whitespace-pre-line text-zinc-800">{r.body}</p>
                      {r.recordingId ? (
                        <div className="rounded-xl bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600">
                          <p>
                            <b className="text-zinc-800">Call</b>
                            {r.recordingAt ? ` · ${formatDateTime(r.recordingAt)}` : ""}
                            {r.recordingSec !== null ? ` · ${formatClock(r.recordingSec)}` : ""}
                          </p>
                          {playable ? <audio controls preload="none" src={`/api/v1/recordings/${r.recordingId}`} className="mt-1.5 h-9 w-full max-w-md" /> : null}
                        </div>
                      ) : null}
                      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                        {r.agentName ? (
                          <div className="flex gap-1">
                            <dt>Agent</dt>
                            <dd className="font-bold text-zinc-700">{r.agentName}</dd>
                          </div>
                        ) : null}
                        <div className="flex gap-1">
                          <dt>{call ? "Reviewed by" : "Written by"}</dt>
                          <dd className="font-bold text-zinc-700">
                            {r.reviewerName} ({ROLE_LABELS[r.reviewerRole]})
                          </dd>
                        </div>
                        <div>
                          <dd>{formatDateTime(r.createdAt)}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} total={total} params={params} /> : null}
      </section>
    );
  });
}
