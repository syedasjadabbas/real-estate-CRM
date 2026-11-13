"use client";

import { extraPhoneSlots } from "@/modules/contacts/constants";
import { OTHER_CITY } from "@/modules/cities/constants";
import { Check } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { LEAD_STAGES, STAGE_LABELS, type LeadStage } from "@/modules/leads/constants";
import type { LeadDetail, LeadLookups } from "@/modules/leads/queries";
import {
  addNoteAction,
  addReviewAction,
  assignLeadAction,
  changeStageAction,
  completeFollowUpAction,
  markLostAction,
  updateLeadAction,
} from "../actions";
import { formatDateTime } from "../format";
import { ApprovalActions } from "./approval-actions";
import { FollowUpForm, textareaClass } from "./follow-up-dialog";
import { LeadFields, selectClass, type LeadFormValues } from "./lead-fields";

export function PanelCard({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("overflow-hidden", className)}>
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
export function StagePanel({ detail, lostReasons }: { detail: LeadDetail; lostReasons: LeadLookups["lostReasons"] }) {
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
        setLostMsg({ text: result.data.status === "lost" ? "Lead marked lost." : "Lost request sent for manager approval.", ok: true });
        setReasonId("");
        setLostNote("");
      } else setLostMsg({ text: result.fields?.lostReasonId ?? result.message, ok: false });
    });

  return (
    <>
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
            {permissions.decideLost ? <ApprovalActions approvalId={pendingLostRequest.id} /> : <p>Waiting for a manager decision.</p>}
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
              {permissions.markLostDirect ? "Mark lost" : "Request lost (needs manager approval)"}
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

export function FollowUpsPanel({ detail }: { detail: LeadDetail }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const now = detail.generatedAt;
  return (
    <PanelCard title="Follow-ups">
      <div className="space-y-4">
        {detail.followUps.length === 0 ? (
          <EmptyState size="sm">No follow-ups yet.</EmptyState>
        ) : (
          <ul className="space-y-1.5">
            {detail.followUps.map((f) => {
              const overdue = f.status === "pending" && new Date(f.dueAt).getTime() < now;
              return (
                <li key={f.id} className="flex items-start justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
                  <div className="min-w-0">
                    <p className={cn("font-bold", overdue ? "text-rose-600" : f.status === "pending" ? "text-zinc-900" : "text-zinc-400 line-through")}>
                      {formatDateTime(f.dueAt)}
                      {overdue ? " · overdue" : ""}
                    </p>
                    {f.note ? <p className="text-zinc-600">{f.note}</p> : null}
                    {f.status === "done" ? <p className="text-[11px] text-zinc-500">Done {formatDateTime(f.doneAt)}</p> : null}
                  </div>
                  {f.status === "pending" && detail.permissions.edit ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await completeFollowUpAction(f.id);
                          setError(result.ok ? null : result.message);
                        })
                      }
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200/80 bg-white px-2 py-1 text-[10px] font-black text-zinc-700 uppercase hover:bg-zinc-50 disabled:opacity-50"
                    >
                      <Check aria-hidden="true" className="size-3" /> Done
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <Status message={error} />
        {detail.permissions.scheduleFollowUp ? (
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

export function ReviewsPanel({ detail }: { detail: LeadDetail }) {
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  if (!detail.permissions.review && detail.reviews.length === 0) return null;
  return (
    <PanelCard title="Manager reviews">
      <div className="space-y-3">
        {detail.reviews.length === 0 ? <p className="text-xs text-zinc-500">No reviews yet.</p> : null}
        {detail.reviews.map((r) => (
          <div key={r.id} className="rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
            <p className="whitespace-pre-line text-zinc-800">{r.body}</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              {r.reviewerName} · {formatDateTime(r.createdAt)}
            </p>
          </div>
        ))}
        {detail.permissions.review ? (
          <div className="space-y-2 border-t border-zinc-100 pt-3">
            <label className="sr-only" htmlFor="new-review">
              Review
            </label>
            <textarea id="new-review" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Feedback for the agent…" className={textareaClass} disabled={pending} />
            <Button
              variant="secondary"
              size="lg"
              disabled={!body.trim() || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await addReviewAction(detail.lead.id, body);
                  if (result.ok) {
                    setBody("");
                    setMsg({ text: "Review added.", ok: true });
                  } else setMsg({ text: result.message, ok: false });
                })
              }
            >
              Add review
            </Button>
            <Status message={msg?.text ?? null} ok={msg?.ok} />
          </div>
        ) : null}
      </div>
    </PanelCard>
  );
}

export function EditDetailsForm({ detail, lookups }: { detail: LeadDetail; lookups: LeadLookups }) {
  const { lead } = detail;
  const initial: LeadFormValues = {
    name: lead.name,
    phoneCountryCode: lead.phoneCountryCode,
    phoneNumber: lead.phoneNumber,
    email: lead.email ?? "",
    gender: lead.gender ?? "",
    desiredSize: lead.desiredSize ?? "",
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
            setMsg({ text: result.data.changed.length ? "Changes saved." : "Nothing changed.", ok: true });
          } else {
            setErrors(result.fields ?? {});
            setMsg({ text: result.message, ok: false });
          }
        });
      }}
      className="space-y-4"
    >
      <LeadFields values={values} onChange={(p) => setValues((v) => ({ ...v, ...p }))} errors={errors} lookups={lookups} projectId={lead.projectId} currentCity={lead.cityId ? { id: lead.cityId, name: lead.cityName } : null} disabled={pending || !detail.permissions.editDetails} />
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
