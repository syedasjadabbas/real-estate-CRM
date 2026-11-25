"use client";

import { extraPhoneSlots } from "@/modules/contacts/constants";
import { OTHER_CITY } from "@/modules/cities/constants";
import { Star } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { INBOUND_LABELS, LEAD_STAGES, STAGE_LABELS, type LeadStage } from "@/modules/leads/constants";
import type { LeadDetail, LeadLookups } from "@/modules/leads/queries";
import {
  addNoteAction,
  addReviewAction,
  assignLeadAction,
  changeStageAction,
  markLostAction,
  updateLeadAction,
} from "../actions";
import { ROLE_LABELS } from "@/server/auth/types";
import { formatDateTime, noContactLabel, since } from "../format";
import { ApprovalActions } from "./approval-actions";
import { FollowUpItem } from "./follow-up-item";
import { FollowUpForm, textareaClass } from "./follow-up-dialog";
import { namePartsOf } from "@/lib/person-name";
import { LeadFields, selectClass, type LeadFormValues } from "./lead-fields";
import { RatingStars } from "./rating-stars";

export function PanelCard({ title, children, className, id }: { title: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <Card id={id} className={cn("overflow-hidden", className)}>
      <h3 className="border-b border-zinc-100 px-4 py-3.5 text-sm leading-5 font-black">{title}</h3>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function Status({ message, ok }: { message: string | null; ok?: boolean }) {
  if (!message) return null;
  return (
    <p role={ok ? "status" : "alert"} className={cn("text-xs font-semibold", ok ? "text-brand" : "text-rose-600")}>
      {message}
    </p>
  );
}

/**
 * Pipeline stage (with optional remarks recorded on the timeline), then a separate Lost lead card:
 * the lost request or decision is its own step, not part of a stage move.
 */
export function StagePanel({
  detail,
  lostReasons,
  showStage = true,
}: {
  detail: LeadDetail;
  lostReasons: LeadLookups["lostReasons"];
  /** False when the "Update after call" card already offers the stage (14 Nov 2026): only Lost lead shows. */
  showStage?: boolean;
}) {
  const { lead, permissions, pendingLostRequest } = detail;
  const [target, setTarget] = useState<string>("");
  const [remarks, setRemarks] = useState("");
  const [reasonId, setReasonId] = useState("");
  const [lostNote, setLostNote] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [lostMsg, setLostMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const options = LEAD_STAGES.filter((s) => s !== lead.stage && s !== "lost_lead" && s !== "booked");
  const showLost = Boolean(pendingLostRequest) || permissions.markLostDirect || permissions.requestLost || permissions.lostNeedsBookingCancelled;

  const move = () =>
    startTransition(async () => {
      const result = await changeStageAction(lead.id, target, remarks);
      setMsg(result.ok ? { text: `Moved to ${STAGE_LABELS[target as LeadStage]}.`, ok: true } : { text: result.message, ok: false });
      if (result.ok) {
        setTarget("");
        setRemarks("");
      }
    });

  const lose = () =>
    startTransition(async () => {
      const result = await markLostAction(lead.id, { lostReasonId: reasonId, note: lostNote });
      if (result.ok) {
        setLostMsg({ text: result.data.status === "lost" ? "Lead marked lost." : "Lost request sent. An Admin decides it.", ok: true });
        setReasonId("");
        setLostNote("");
      } else setLostMsg({ text: result.fields?.lostReasonId ?? result.message, ok: false });
    });

  return (
    <>
    {showStage ? (
    <PanelCard title="Pipeline stage">
      <div className="space-y-4">
        {permissions.edit ? (
          <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Target stage" className="min-w-0 flex-1">
              {(id) => (
                <select id={id} value={target} onChange={(e) => setTarget(e.target.value)} className={selectClass} disabled={pending}>
                  <option value="">Select target stage…</option>
                  {options.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Button variant="primary" size="lg" disabled={!target || pending} onClick={move}>
              Move
            </Button>
          </div>
            <Field label="Remarks">
              {(id) => (
                <textarea
                  id={id}
                  rows={2}
                  maxLength={1000}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Why the lead is moving, what was agreed (optional)"
                  className={textareaClass}
                  disabled={pending}
                />
              )}
            </Field>
          </div>
        ) : (
          <p className="text-xs text-zinc-600">This lead is read-only for you.</p>
        )}
        <Status message={msg?.text ?? null} ok={msg?.ok} />
      </div>
    </PanelCard>
    ) : null}

    {showLost ? (
    <PanelCard title="Lost lead">
      <div className="space-y-4">

        {pendingLostRequest ? (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-950">
            <p>
              <span className="font-bold">Lost request pending</span> · {pendingLostRequest.reason ?? "No reason"} ·{" "}
              {formatDateTime(pendingLostRequest.createdAt)}
              {pendingLostRequest.note ? <span className="block">“{pendingLostRequest.note}”</span> : null}
            </p>
            {permissions.decideLost ? <ApprovalActions approvalId={pendingLostRequest.id} /> : <p>Waiting for an Admin to decide.</p>}
          </div>
        ) : null}

        {permissions.lostNeedsBookingCancelled ? (
          <p className="rounded-xl bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-600">
            This lead has an open booking. Cancel the booking first (this releases the unit), then the lead can be marked lost.
          </p>
        ) : null}

        {permissions.markLostDirect || permissions.requestLost ? (
          <div className="space-y-2">
            <p className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">
              {permissions.markLostDirect ? "Mark lost" : "Request lost (an Admin decides)"}
            </p>
            <select aria-label="Lost reason" value={reasonId} onChange={(e) => setReasonId(e.target.value)} className={selectClass} disabled={pending}>
              <option value="">Choose a lost reason…</option>
              {lostReasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <textarea
              aria-label="Lost note"
              rows={2}
              value={lostNote}
              onChange={(e) => setLostNote(e.target.value)}
              placeholder="Note (optional)"
              className={textareaClass}
              disabled={pending}
            />
            <Button variant="secondary" size="lg" className="border-rose-200 text-rose-700 hover:bg-rose-50" disabled={!reasonId || pending} onClick={lose}>
              {permissions.markLostDirect ? "Mark lost" : "Send lost request"}
            </Button>
          </div>
        ) : null}
        <Status message={lostMsg?.text ?? null} ok={lostMsg?.ok} />
      </div>
    </PanelCard>
    ) : null}
    </>
  );
}

export function AssignPanel({ leadId, ownerId, owners }: { leadId: string; ownerId: string | null; owners: { id: string; name: string }[] }) {
  const [value, setValue] = useState(ownerId ?? "");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <PanelCard title="Assignment">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Owner" className="min-w-0 flex-1">
          {(id) => (
            <select id={id} value={value} onChange={(e) => setValue(e.target.value)} className={selectClass} disabled={pending}>
              {ownerId ? null : <option value="">Unassigned</option>}
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Button
          variant="primary"
          size="lg"
          disabled={!value || value === ownerId || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await assignLeadAction(leadId, value);
              setMsg(result.ok ? { text: "Lead reassigned.", ok: true } : { text: result.message, ok: false });
            })
          }
        >
          Reassign
        </Button>
      </div>
      <div className="mt-2">
        <Status message={msg?.text ?? null} ok={msg?.ok} />
      </div>
    </PanelCard>
  );
}

/** `canSchedule` false when the "Update after call" card schedules the next follow-up (14 Nov 2026). */
export function FollowUpsPanel({ detail, canSchedule = true }: { detail: LeadDetail; canSchedule?: boolean }) {
  const now = detail.generatedAt;
  return (
    <PanelCard title="Follow-ups">
      <div className="space-y-4">
        {detail.followUps.length === 0 ? (
          <EmptyState size="sm">No follow-ups yet.</EmptyState>
        ) : (
          <ul className="space-y-1.5">
            {detail.followUps.map((f) => (
              <FollowUpItem key={f.id} item={f} now={now} canEdit={detail.permissions.edit} />
            ))}
          </ul>
        )}
        {canSchedule && detail.permissions.scheduleFollowUp ? (
          <div className="border-t border-zinc-100 pt-4">
            <FollowUpForm leadId={detail.lead.id} />
          </div>
        ) : null}
      </div>
    </PanelCard>
  );
}

export function NotePanel({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  if (!canEdit) return null;
  return (
    <PanelCard title="Notes">
      <div className="space-y-2">
        <label className="sr-only" htmlFor="new-note">
          New note
        </label>
        <textarea
          id="new-note"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Call outcome, next step, objection…"
          className={textareaClass}
          disabled={pending}
        />
        <Button
          variant="primary"
          size="lg"
          disabled={!body.trim() || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await addNoteAction(leadId, body);
              if (result.ok) {
                setBody("");
                setMsg({ text: "Note added.", ok: true });
              } else setMsg({ text: result.message, ok: false });
            })
          }
        >
          Add note
        </Button>
        <Status message={msg?.text ?? null} ok={msg?.ok} />
      </div>
    </PanelCard>
  );
}

/**
 * Notes and call reviews on a lead. Admins, Super Admins and Managers can also score the call 1–5
 * and say which recording they listened to; the lead's owner is notified (16 Nov 2026).
 */
export function ReviewsPanel({ detail, recordings = [] }: { detail: LeadDetail; recordings?: { id: string; name: string; createdAt: Date | string; uploadedBy: string | null }[] }) {
  const [body, setBody] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [recordingId, setRecordingId] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  if (!detail.permissions.review && detail.reviews.length === 0) return null;
  const rate = detail.permissions.rateCalls;
  return (
    <PanelCard title="Call reviews & notes">
      <div className="space-y-3">
        {detail.reviews.length === 0 ? <p className="text-xs text-zinc-500">No reviews yet.</p> : null}
        {detail.reviews.map((r) => (
          <div key={r.id} className="rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
            {r.rating !== null || r.recordingId ? (
              <p className="mb-1 flex flex-wrap items-center gap-2">
                {r.rating !== null ? <RatingStars rating={r.rating} /> : null}
                {r.recordingId ? (
                  <span className="text-[11px] font-semibold text-zinc-500">
                    {r.recordingName ? `Call: ${r.recordingName}${r.recordingAt ? ` · ${formatDateTime(r.recordingAt)}` : ""}` : "Call recording (since removed)"}
                  </span>
                ) : null}
              </p>
            ) : null}
            <p className="whitespace-pre-line text-zinc-800">{r.body}</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              {r.reviewerName} ({ROLE_LABELS[r.reviewerRole]}) · {formatDateTime(r.createdAt)}
            </p>
          </div>
        ))}
        {detail.permissions.review ? (
          <div className="space-y-2 border-t border-zinc-100 pt-3">
            <label className="sr-only" htmlFor="new-review">
              Note or review
            </label>
            {rate ? (
              <div className="space-y-2 rounded-xl bg-zinc-50 p-2.5">
                <p className="text-[11px] font-bold text-zinc-600">Call review (optional)</p>
                <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Score the call, 1 to 5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={rating === n}
                      aria-label={`${n} out of 5`}
                      title={["Poor", "Needs work", "OK", "Good", "Excellent"][n - 1]}
                      disabled={pending}
                      onClick={() => setRating((r) => (r === n ? null : n))}
                      className="rounded-md p-0.5 hover:bg-amber-50"
                    >
                      <Star aria-hidden="true" className={cn("size-5", rating !== null && n <= rating ? "fill-amber-400 text-amber-400" : "text-zinc-300")} />
                    </button>
                  ))}
                  <span className="ml-1 text-[11px] text-zinc-500">{rating === null ? "No score" : `${rating}/5 · ${["Poor", "Needs work", "OK", "Good", "Excellent"][rating - 1]}`}</span>
                </div>
                {recordings.length ? (
                  <>
                    <label htmlFor="review-recording" className="sr-only">
                      Which call
                    </label>
                    <select id="review-recording" value={recordingId} onChange={(e) => setRecordingId(e.target.value)} className={selectClass} disabled={pending}>
                      <option value="">Which call? (optional)</option>
                      {recordings.map((rec) => (
                        <option key={rec.id} value={rec.id}>
                          {formatDateTime(rec.createdAt)} · {rec.name}
                          {rec.uploadedBy ? ` · ${rec.uploadedBy}` : ""}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <p className="text-[11px] text-zinc-500">No call recordings on this lead yet.</p>
                )}
              </div>
            ) : null}
            <textarea id="new-review" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={rate ? "What went well, what to improve, next step…" : "Interest, budget, next step, or feedback…"} className={textareaClass} disabled={pending} />
            <Button
              variant="secondary"
              size="lg"
              disabled={!body.trim() || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await addReviewAction(detail.lead.id, body, rating, recordingId || null);
                  if (result.ok) {
                    setBody("");
                    setRating(null);
                    setRecordingId("");
                    setMsg({ text: detail.lead.ownerId && rate ? "Saved. The lead's owner has been notified." : "Saved.", ok: true });
                  } else setMsg({ text: result.message, ok: false });
                })
              }
            >
              {rating !== null ? "Save call review" : "Add note / review"}
            </Button>
            <Status message={msg?.text ?? null} ok={msg?.ok} />
          </div>
        ) : null}
      </div>
    </PanelCard>
  );
}

function ReadOnly({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</p>
      <div className="mt-1 text-sm font-semibold text-zinc-800">{children}</div>
    </div>
  );
}

export function EditDetailsForm({ detail, lookups }: { detail: LeadDetail; lookups: LeadLookups }) {
  const { lead } = detail;
  const initial: LeadFormValues = {
    ...namePartsOf(lead),
    phoneCountryCode: lead.phoneCountryCode,
    phoneNumber: lead.phoneNumber,
    email: lead.email ?? "",
    gender: lead.gender ?? "",
    desiredSize: lead.desiredSize ?? "",
    propertyType: lead.propertyType ?? "",
    campaign: lead.campaign ?? "",
    sourceId: lead.sourceId,
    budgetRangeId: lead.budgetRangeId ?? "",
    priority: lead.priority,
    cityId: lead.cityOther ? OTHER_CITY : (lead.cityId ?? ""),
    phones: extraPhoneSlots(lead.phones ?? []),
    cityOther: lead.cityOther ?? "",
  };
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  return (
    <form
      noValidate
      aria-label="Lead details"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await updateLeadAction(lead.id, values);
          if (result.ok) {
            setErrors({});
            setMsg({
              text: [result.data.changed.length ? "Changes saved." : null, result.data.nameRequested ? "The new name is waiting for an Admin." : null].filter(Boolean).join(" ") || "Nothing changed.",
              ok: true,
            });
            // The name stays as it was until an Admin approves the new one.
            if (result.data.nameRequested) setValues((v) => ({ ...v, firstName: initial.firstName, lastName: initial.lastName }));
          } else {
            setErrors(result.fields ?? {});
            setMsg({ text: result.message, ok: false });
          }
        });
      }}
      className="space-y-4"
    >
      <LeadFields values={values} onChange={(p) => setValues((v) => ({ ...v, ...p }))} errors={errors} lookups={lookups} lockPhones={!detail.permissions.editPhones} hideContact projectId={lead.projectId}
        requirementsExtra={
          <ReadOnly label="Project interests">
            {lead.projectName}
            {lead.otherProjects.length ? <span className="block text-xs font-medium text-zinc-500">Also interested in {lead.otherProjects.join(", ")}</span> : null}
          </ReadOnly>
        }
        interestExtra={
          <>
            <ReadOnly label="Acquisition channel">{INBOUND_LABELS[lead.inboundChannel]}</ReadOnly>
            <ReadOnly label="Created">{formatDateTime(lead.createdAt)}</ReadOnly>
            <ReadOnly label="Time in stage">{since(lead.stageChangedAt, detail.generatedAt)}</ReadOnly>
            <ReadOnly label="Last contact">{lead.lastContactAt ? formatDateTime(lead.lastContactAt) : noContactLabel(lead.stage)}</ReadOnly>
            <ReadOnly label="First touch">{lead.firstTouchAt ? formatDateTime(lead.firstTouchAt) : "—"}</ReadOnly>
            <ReadOnly label="Repeat enquiry">{lead.regeneratedAt ? `Latest ${formatDateTime(lead.regeneratedAt)}` : "None"}</ReadOnly>
          </>
        }
        currentCity={lead.cityId ? { id: lead.cityId, name: lead.cityName } : null} disabled={pending || !detail.permissions.editDetails} />
      {detail.permissions.editDetails ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Status message={msg?.text ?? null} ok={msg?.ok} />
          <Button variant="secondary" size="lg" disabled={!dirty || pending} onClick={() => { setValues(initial); setErrors({}); setMsg(null); }}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="lg" disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
