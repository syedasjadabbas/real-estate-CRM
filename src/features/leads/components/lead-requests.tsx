"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { PhoneInput } from "@/features/contacts/components/phone-input";
import type { LeadRequestRow } from "@/modules/leads/requests";
import { decideLeadRequestAction, markOpenedAction } from "../actions";
import { formatDateTime } from "../format";
import { COUNTRY_CODES, selectClass } from "./lead-fields";

const TITLES: Record<LeadRequestRow["type"], string> = { name_change: "Name change", wrong_number: "Wrong number", booked: "Successfully booked" };

/** Marks the lead opened by its agent, once the page is really on screen (not when it is only prefetched). */
export function MarkOpened({ leadId }: { leadId: string }) {
  useEffect(() => {
    void markOpenedAction(leadId);
  }, [leadId]);
  return null;
}

/** One request waiting for an Admin: what is asked, and the decision for those who may make it. */
export function LeadRequestCard({ request: r, canDecide, showLead = false }: { request: LeadRequestRow; canDecide: boolean; showLead?: boolean }) {
  const [comment, setComment] = useState("");
  const [cc, setCc] = useState(r.phoneCountryCode);
  const [number, setNumber] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const data = r.data as Record<string, unknown>;
  const decide = (input: Record<string, unknown>) =>
    startTransition(async () => {
      const res = await decideLeadRequestAction(r.id, { comment, ...input });
      setErrors(res.ok ? {} : (res.fields ?? {}));
      setError(res.ok ? null : res.message);
    });

  return (
    <div role="status" className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-amber-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black">{TITLES[r.type]} · waiting for an Admin</p>
        <p className="text-[11px]">
          {r.requestedBy} · {formatDateTime(r.createdAt)}
        </p>
      </div>
      {showLead ? (
        <Link href={`/dashboard/leads/${r.leadId}`} className="text-sm font-bold hover:underline">
          {r.leadName} <span className="text-xs font-semibold tracking-[0.05em]">{r.leadCode}</span>
        </Link>
      ) : null}
      <p className="text-xs">
        {r.type === "name_change" ? (
          <>
            <b>{String(data.from)}</b> → <b>{String(data.to)}</b>
          </>
        ) : r.type === "wrong_number" ? (
          <>The agent says the number is wrong{canDecide ? `: ${String(data.phone)}` : ". You can work on the lead once it is sorted out"}.</>
        ) : (
          <>
            Unit <b>{String(data.unitNo)}</b>,{typeof data.amount === "number" ? ` PKR ${data.amount.toLocaleString("en-US")} received,` : ""} {String(data.files)} screenshot{data.files === 1 ? "" : "s"}.{" "}
            <Link href={`/dashboard/bookings/${String(data.bookingId)}`} className="font-bold underline">
              Open the booking
            </Link>
          </>
        )}
      </p>
      {r.note ? <p className="text-xs whitespace-pre-line">“{r.note}”</p> : null}
      {canDecide ? (
        <div className="space-y-2">
          {r.type === "wrong_number" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end">
              <Field label="Country code">
                {(id) => (
                  <select id={id} value={cc} onChange={(e) => setCc(e.target.value)} className={selectClass} disabled={pending}>
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <PhoneInput label="Correct number" countryCode={cc} value={number} onChange={setNumber} error={errors.phoneNumber} disabled={pending} />
              <Button variant="primary" size="lg" disabled={pending || !number.trim()} onClick={() => decide({ approve: true, phoneCountryCode: cc, phoneNumber: number })}>
                Correct it
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`request-comment-${r.id}`}>
              Comment
            </label>
            <input
              id={`request-comment-${r.id}`}
              value={comment}
              maxLength={1000}
              onChange={(e) => setComment(e.target.value)}
              placeholder={r.type === "wrong_number" ? "Comment (needed if the number is right)" : "Reason (needed to reject)"}
              className="h-9 min-w-0 flex-1 rounded-xl border border-zinc-200/80 bg-white px-3 text-xs font-medium shadow-hairline focus:border-brand/50 focus:outline-none"
            />
            <Button variant={r.type === "wrong_number" ? "secondary" : "primary"} disabled={pending} onClick={() => decide({ approve: true })}>
              {r.type === "wrong_number" ? "It is wrong: mark Lost" : "Approve"}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => decide({ approve: false })}>
              {r.type === "wrong_number" ? "Number is right" : "Reject"}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-xs font-semibold text-rose-600">
              {errors.comment ?? error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
