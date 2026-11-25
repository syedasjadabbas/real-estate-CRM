import type { Metadata } from "next";
import { Headphones, MessageSquareText, Star } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StagePill } from "@/features/leads/components/chips";
import { ScopeNotice, withLeadsAccess } from "@/features/leads/components/list-view";
import { formatDateTime } from "@/features/leads/format";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams, withParams } from "@/features/leads/url";
import { CallPlayer } from "@/features/recordings/components/call-player";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { reviewsFeed } from "@/modules/leads/queries";
import { canPlayRecordings } from "@/modules/recordings/service";
import { formatClock } from "@/modules/recordings/validation";
import { ROLE_LABELS } from "@/server/auth/types";

export const metadata: Metadata = { title: "Lead reviews" };

const PATH = "/dashboard/leads/reviews";
const field = "h-9 rounded-xl border border-zinc-200/80 bg-white px-2.5 text-xs font-semibold shadow-hairline";
const caption = "text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase";
const TONES = {
  good: { block: "bg-emerald-50 text-emerald-800", bar: "bg-emerald-500" },
  fair: { block: "bg-amber-50 text-amber-800", bar: "bg-amber-400" },
  poor: { block: "bg-rose-50 text-rose-800", bar: "bg-rose-500" },
};
const toneOf = (score: number) => TONES[score >= 3.5 ? "good" : score >= 2.5 ? "fair" : "poor"];
const WORDS: Record<number, string> = { 5: "Excellent", 4: "Good", 3: "Fair", 2: "Weak", 1: "Poor" };

/** Call reviews and notes: scores, agents side by side, and each review with its recording (client, 25 Nov 2026). */
export default function ReviewsPage({ searchParams }: PageProps<"/dashboard/leads/reviews">) {
  return withLeadsAccess(async ({ actor, db, projectId }) => {
    const params = flattenParams(await searchParams);
    const { rows: reviews, page, pageCount, total, query, agents, agentScores, stats, byStar } = await reviewsFeed(db, actor, projectId, params);
    const playable = canPlayRecordings(actor);
    const filtered = Boolean(query.q || query.rating || query.kind || query.agent);
    const most = Math.max(1, ...Object.values(byStar));
    const href = (over: Record<string, string | null>) => withParams(PATH, params, { ...over, page: null });
    const kinds = [
      { key: null, label: "All", n: stats.all },
      { key: "call", label: "Call reviews", n: stats.calls },
      { key: "note", label: "Notes", n: stats.all - stats.calls },
    ];
    return (
      <section className="space-y-5" aria-label="Reviews">
        <PageHeader
          as="h2"
          title="Call reviews & notes"
          description={actor.role === "agent" ? "Notes and reviews on leads assigned to you, yours and your Admins'." : "Notes and reviews written by agents and Admins on leads in your scope, newest first."}
        />
        <ScopeNotice actor={actor} />

        <div className={cn("grid grid-cols-1 gap-3", agentScores.length > 1 && "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")}>
          <Card className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
            <div>
              <p className={caption}>Average score</p>
              <p className="mt-1 flex items-baseline gap-1">
                <span className="text-[44px] leading-none font-black tracking-[-0.03em] tabular-nums">{stats.average ?? "—"}</span>
                {stats.average === null ? null : <span className="text-sm font-bold text-zinc-500">/ 5</span>}
              </p>
              <ul className="mt-3 space-y-0.5 text-[11px] text-zinc-600">
                <li>
                  <b className="text-zinc-900 tabular-nums">{formatInt(stats.scored)}</b> scored calls
                </li>
                <li>
                  <b className="text-zinc-900 tabular-nums">{formatInt(stats.recorded)}</b> with a recording
                </li>
                <li className={stats.low ? "text-rose-700" : undefined}>
                  <b className="tabular-nums">{formatInt(stats.low)}</b> scored 1 or 2
                </li>
              </ul>
            </div>
            <ul className="space-y-0.5" aria-label="Scores">
              {[5, 4, 3, 2, 1].map((n) => {
                const on = query.rating === n;
                return (
                  <li key={n}>
                    <Link
                      href={href({ rating: on ? null : String(n) })}
                      aria-current={on ? "true" : undefined}
                      className={cn("grid grid-cols-[92px_minmax(0,1fr)_24px] items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-bold hover:bg-zinc-100", on && "bg-zinc-100 ring-1 ring-zinc-300")}
                    >
                      <span className="inline-flex items-center gap-1">
                        {n}
                        <Star aria-hidden="true" className="size-3 fill-amber-400 text-amber-400" />
                        <span className="font-semibold text-zinc-600">{WORDS[n]}</span>
                      </span>
                      <span className="h-2 overflow-hidden rounded-full bg-zinc-100">
                        <span className={cn("block h-full rounded-full", toneOf(n).bar)} style={{ width: `${((byStar[n] ?? 0) / most) * 100}%` }} />
                      </span>
                      <span className="text-right tabular-nums">{formatInt(byStar[n] ?? 0)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
          {agentScores.length > 1 ? (
            <Card className="p-5">
              <p className={caption}>Score by agent</p>
              <ul className="mt-2 max-h-[190px] space-y-0.5 overflow-y-auto p-px">
                {agentScores.map((a) => {
                  const on = query.agent === a.id;
                  return (
                    <li key={a.id}>
                      <Link
                        href={href({ agent: on ? null : a.id })}
                        aria-current={on ? "true" : undefined}
                        className={cn("grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_30px_48px] items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-zinc-100", on && "bg-zinc-100 ring-1 ring-zinc-300")}
                      >
                        <span className="truncate font-bold">{a.name}</span>
                        <span className="h-2 overflow-hidden rounded-full bg-zinc-100">
                          <span className={cn("block h-full rounded-full", toneOf(a.average).bar)} style={{ width: `${(a.average / 5) * 100}%` }} />
                        </span>
                        <span className="text-right font-black tabular-nums">{a.average.toFixed(1)}</span>
                        <span className="text-right text-[11px] text-zinc-500 tabular-nums">
                          {formatInt(a.n)} {a.n === 1 ? "call" : "calls"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </div>

        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <nav aria-label="Type" className="flex flex-wrap gap-1.5">
              {kinds.map((k) => {
                const on = (query.kind ?? null) === k.key;
                return (
                  <Link
                    key={k.label}
                    href={href({ kind: k.key })}
                    aria-current={on ? "true" : undefined}
                    className={cn("inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-bold", on ? "bg-brand text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200")}
                  >
                    {k.label}
                    <span className="tabular-nums">{formatInt(k.n)}</span>
                  </Link>
                );
              })}
            </nav>
            {filtered ? (
              <span className="flex items-center gap-2 text-xs font-semibold text-zinc-600">
                {formatInt(total)} found
                <Link href={PATH} className={buttonClasses({ variant: "secondary" })}>
                  Clear filters
                </Link>
              </span>
            ) : null}
          </div>
          <form method="get" action={PATH} className="flex flex-wrap items-center gap-2" aria-label="Filter reviews">
            <input key={`q${query.q ?? ""}`} type="search" name="q" aria-label="Search reviews" defaultValue={query.q ?? ""} placeholder="Customer, code, reviewer or words" maxLength={100} className={cn(field, "min-w-0 flex-1 basis-56")} />
            {agents.length > 1 ? (
              <select key={query.agent ?? "all"} name="agent" aria-label="Agent" defaultValue={query.agent ?? ""} className={field}>
                <option value="">All agents</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            ) : null}
            {query.rating ? <input type="hidden" name="rating" value={query.rating} /> : null}
            {query.kind ? <input type="hidden" name="kind" value={query.kind} /> : null}
            <Button type="submit" variant="primary">
              Search
            </Button>
          </form>
        </Card>

        {reviews.length === 0 ? (
          <EmptyState>{filtered ? "Nothing matches these filters." : "No notes or reviews yet. Notes and reviews added on a lead's page appear here."}</EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {reviews.map((r) => {
              const call = r.rating !== null || r.recordingId !== null;
              return (
                <li key={r.id} className="min-w-0">
                  <Card className="flex h-full flex-col overflow-hidden">
                    <div className="flex flex-1 gap-4 p-4">
                      {r.rating !== null ? (
                        <div role="img" aria-label={`Scored ${r.rating} out of 5`} className={cn("flex h-16 w-[68px] shrink-0 flex-col items-center justify-center rounded-2xl", toneOf(r.rating).block)}>
                          <span className="inline-flex items-center gap-1 text-2xl leading-7 font-black tabular-nums">
                            {r.rating}
                            <Star aria-hidden="true" className="size-4 fill-current" />
                          </span>
                          <span className="text-[10px] font-bold">{WORDS[r.rating]}</span>
                        </div>
                      ) : (
                        <div className="flex h-16 w-[68px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl bg-zinc-100 text-zinc-600">
                          {call ? <Headphones aria-hidden="true" className="size-5" /> : <MessageSquareText aria-hidden="true" className="size-5" />}
                          <span className="text-[10px] font-bold">{call ? "Call" : "Note"}</span>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <Link href={`/dashboard/leads/${r.leadId}`} className="text-[15px] font-black hover:text-brand hover:underline">
                            {r.leadName} <span className="text-[11px] font-semibold tracking-[0.05em] text-zinc-500">{r.leadCode}</span>
                          </Link>
                          <StagePill stage={r.stage} />
                        </div>
                        <p className="mt-1.5 text-sm leading-[21px] break-words whitespace-pre-line text-zinc-700">{r.body}</p>
                      </div>
                    </div>
                    {r.recordingId ? (
                      <div className="mx-4 mb-4 rounded-xl bg-zinc-50 px-3 py-2.5">
                        {playable ? (
                          <CallPlayer recordingId={r.recordingId} seconds={r.recordingSec} label={`the call with ${r.leadName}`} />
                        ) : (
                          <p className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-700">
                            <Headphones aria-hidden="true" className="size-3.5" />
                            Recorded call{r.recordingSec !== null ? ` · ${formatClock(r.recordingSec)}` : ""}
                          </p>
                        )}
                        {r.recordingAt ? <p className={cn("mt-1 text-[11px] text-zinc-500", playable ? "pl-12" : "pl-5")}>Call on {formatDateTime(r.recordingAt)}</p> : null}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-500">
                      <span className="flex flex-wrap gap-x-4 gap-y-1">
                        {r.agentName ? (
                          <span>
                            Agent <b className="text-zinc-800">{r.agentName}</b>
                          </span>
                        ) : null}
                        <span>
                          {call ? "Reviewed by" : "Written by"} <b className="text-zinc-800">{r.reviewerName}</b> ({ROLE_LABELS[r.reviewerRole]})
                        </span>
                      </span>
                      <time dateTime={r.createdAt.toISOString()}>{formatDateTime(r.createdAt)}</time>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
        {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} total={total} params={params} /> : null}
      </section>
    );
  });
}
