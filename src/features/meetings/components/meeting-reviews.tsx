"use client";

import { Star } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { RatingStars } from "@/features/leads/components/rating-stars";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { addMeetingReviewAction } from "../actions";

type Review = { id: string; rating: number; body: string; createdAt: Date | string; reviewerName: string; reviewerRole: Role };

/** What the agent and the Admins thought of a held meeting (client, 25 Nov 2026). */
export function MeetingReviews({ meetingId, reviews, canReview, held }: { meetingId: string; reviews: Review[]; canReview: boolean; held: boolean }) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const average = reviews.length ? Math.round((reviews.reduce((n, r) => n + r.rating, 0) / reviews.length) * 10) / 10 : null;
  return (
    <PanelCard title={`Reviews · ${reviews.length}${average !== null ? ` · ${average}/5` : ""}`}>
      <div className="space-y-3">
        {reviews.length === 0 ? (
          <EmptyState size="sm">{held ? "No reviews yet." : "A meeting is reviewed after it is held."}</EmptyState>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-xl border border-zinc-200/80 px-3 py-2.5 shadow-hairline">
                <RatingStars rating={r.rating} />
                <p className="mt-1 text-xs whitespace-pre-line text-zinc-800">{r.body}</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {r.reviewerName} ({ROLE_LABELS[r.reviewerRole]}) · {formatDateTime(r.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canReview && held ? (
          <form
            noValidate
            aria-label="Review this meeting"
            className="space-y-3 border-t border-zinc-100 pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const r = await addMeetingReviewAction(meetingId, { rating, body });
                setErrors(r.ok ? {} : (r.fields ?? {}));
                setMsg(r.ok ? { text: "Review saved.", ok: true } : { text: r.message, ok: false });
                if (r.ok) {
                  setRating(0);
                  setBody("");
                }
              });
            }}
          >
            <div>
              <div role="radiogroup" aria-label="Stars" className="inline-flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} disabled={pending} onClick={() => setRating(n)} className="rounded p-0.5 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none">
                    <Star aria-hidden="true" className={cn("size-5", n <= rating ? "fill-amber-400 text-amber-400" : "text-zinc-300")} />
                  </button>
                ))}
              </div>
              {errors.rating ? <p className="text-xs font-semibold text-rose-600">{errors.rating}</p> : null}
            </div>
            <Field label="Review" required error={errors.body}>
              {(id, d) => <textarea id={id} aria-describedby={d} rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} className={textareaClass} disabled={pending} placeholder="How it went, what the customer wants next" />}
            </Field>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {msg ? (
                <p role={msg.ok ? "status" : "alert"} className={cn("mr-auto text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
                  {msg.text}
                </p>
              ) : null}
              <Button type="submit" variant="primary" size="lg" disabled={pending}>
                {pending ? "Saving…" : "Save review"}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </PanelCard>
  );
}
