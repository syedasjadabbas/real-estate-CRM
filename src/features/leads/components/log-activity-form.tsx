"use client";

import { CalendarCheck, MessageCircle, PenLine, PhoneCall, type LucideIcon } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DateTimeInput } from "@/components/ui/date-time-input";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { CALL_RESULTS, CALL_RESULT_LABELS, type CallResult } from "@/modules/leads/call-results";
import { LEAD_STAGES, STAGE_LABELS, type LeadStage } from "@/modules/leads/constants";
import { MEETING_TYPES, MEETING_TYPE_LABELS, wouldMoveLead, type MeetingType } from "@/modules/meetings/constants";
import type { OpenMeeting } from "@/modules/meetings/open";
import { logCallUpdateAction } from "../actions";
import { followUpStatus, formatDateTime, fromLocalInputValue, toLocalInputValue } from "../format";
import { FOLLOW_UP_SUGGESTIONS, textareaClass } from "./follow-up-dialog";
import { selectClass } from "./lead-fields";

const STAGES = LEAD_STAGES.filter((s) => s !== "booked" && s !== "lost_lead");
const KINDS = [
  ["call", "Call", PhoneCall],
  ["meeting", "Meeting", CalendarCheck],
  ["whatsapp", "WhatsApp", MessageCircle],
  ["note", "Note", PenLine],
] as const satisfies readonly (readonly [string, string, LucideIcon])[];
type Kind = (typeof KINDS)[number][0];
const OUTCOMES = [
  ["completed", "It happened"],
  ["no_show", "Customer didn't come"],
  ["rescheduled", "Rescheduled"],
  ["cancelled", "Cancelled"],
] as const;
type Outcome = (typeof OUTCOMES)[number][0];
/** Meeting choice for one that was never scheduled. */
const UNSCHEDULED = "unscheduled";
const MAX_BYTES = 10 * 1024 * 1024;
const fileInput =
  "block w-full text-xs text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-200 file:bg-zinc-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-zinc-800";
const chip = (on: boolean) =>
  cn("rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors", on ? "border-brand bg-brand text-white" : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50");

const NOT_REACHED: CallResult[] = ["no_answer", "busy", "switched_off"];

/** A local "YYYY-MM-DDTHH:MM" for `days` from now at `hour`:00, or `hours` from now. */
function at(opts: { days?: number; hour?: number; hours?: number }) {
  const d = new Date();
  if (opts.hours !== undefined) return toLocalInputValue(new Date(d.getTime() + opts.hours * 3_600_000));
  d.setDate(d.getDate() + (opts.days ?? 0));
  d.setHours(opts.hour ?? 10, 0, 0, 0);
  return toLocalInputValue(d);
}

/** The stage a call result suggests: a first answered call means Contacted; a missed one, Contact attempted. */
function suggestedStage(result: CallResult, current: LeadStage): LeadStage {
  if (result === "talked" && (current === "new_lead" || current === "contact_attempted")) return "contacted";
  if (NOT_REACHED.includes(result) && current === "new_lead") return "contact_attempted";
  return current;
}

/** The follow-up a call suggests: missed calls retry in 3 hours; a booked meeting is confirmed the day before. */
function suggestedFollowUp(result: CallResult, meetingAt: string | null): { due: string; note: string } {
  if (meetingAt) {
    const before = new Date(meetingAt);
    before.setDate(before.getDate() - 1);
    before.setHours(10, 0, 0, 0);
    if (before.getTime() > Date.now() + 30 * 60_000) return { due: toLocalInputValue(before), note: "Confirm the meeting" };
  }
  if (NOT_REACHED.includes(result)) return { due: at({ hours: 3 }), note: "Call back" };
  return { due: at({ days: 1, hour: 10 }), note: "" };
}

export type PendingFollowUp = { id: string; dueAt: Date | string; note: string | null };

/**
 * "Log activity" (client, 24 Nov 2026; before, "Update after call"): the agent records what happened, a call,
 * a meeting, a WhatsApp conversation or a note, and one save does the rest: the meeting record, the stage,
 * Last Contact, the follow-ups it fulfils and the next one. Approvals keep their own steps.
 */
export function LogActivityForm({
  leadId,
  currentStage,
  pendingFollowUps,
  meetings,
  onSaved,
}: {
  leadId: string;
  currentStage: LeadStage;
  pendingFollowUps: PendingFollowUp[];
  meetings: OpenMeeting[];
  onSaved?: (text: string) => void;
}) {
  const [kind, setKind] = useState<Kind>("call");
  const [meetingPick, setMeetingPick] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("completed");
  const [heldAt, setHeldAt] = useState(() => toLocalInputValue(new Date()));
  const [newAt, setNewAt] = useState(() => at({ days: 1, hour: 11 }));
  const [heldType, setHeldType] = useState<MeetingType>("site_visit");
  const [waKind, setWaKind] = useState<"whatsapp_chat" | "whatsapp_call">("whatsapp_chat");
  const [waFiles, setWaFiles] = useState<File[]>([]);
  const [waLength, setWaLength] = useState("");
  const waInput = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<CallResult>("talked");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [stage, setStage] = useState<LeadStage>(suggestedStage("talked", currentStage));
  const [meetingOn, setMeetingOn] = useState(false);
  const [meetingType, setMeetingType] = useState<MeetingType>("site_visit");
  const [meetingAt, setMeetingAt] = useState(() => at({ days: 7, hour: 11 }));
  const [followOn, setFollowOn] = useState(true);
  const [followAt, setFollowAt] = useState(() => suggestedFollowUp("talked", null).due);
  const [followNote, setFollowNote] = useState("");
  const [openedAt] = useState(() => Date.now());
  // Always starts empty: only the agent can say which follow-up this activity fulfils (client, 24 Nov 2026).
  const [ticked, setTicked] = useState<string[]>([]);
  const completeFollowUpIds = pendingFollowUps.map((f) => f.id).filter((id) => ticked.includes(id));
  const [waSent, setWaSent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  // The first scheduled meeting unless the agent picked another that is still there.
  const picked = meetingPick === UNSCHEDULED || meetings.some((m) => m.id === meetingPick) ? meetingPick : (meetings[0]?.id ?? UNSCHEDULED);
  const unscheduled = picked === UNSCHEDULED;
  const happened: Outcome = unscheduled ? "completed" : outcome;

  const stageFor = (k: Kind, r: CallResult, o: Outcome): LeadStage => {
    if (k === "call") return suggestedStage(r, currentStage);
    if (k === "whatsapp") return suggestedStage("talked", currentStage);
    if (k === "meeting" && o === "completed" && wouldMoveLead("complete", currentStage)) return "meeting_done";
    return currentStage;
  };
  // The save (or someone else) moved the lead: suggest from where it is now, never back to the old stage.
  const [seenStage, setSeenStage] = useState(currentStage);
  if (seenStage !== currentStage) {
    setSeenStage(currentStage);
    setStage(stageFor(kind, result, happened));
  }
  const switchTo = (k: Kind) => {
    setKind(k);
    setErrors({});
    setMsg(null);
    setMeetingOn(false);
    setStage(stageFor(k, result, happened));
    const f = suggestedFollowUp(k === "call" ? result : "talked", null);
    setFollowAt(f.due);
    setFollowNote(f.note);
  };
  const chooseOutcome = (o: Outcome) => {
    setOutcome(o);
    setStage(stageFor("meeting", result, o));
  };

  const resuggest = (r: CallResult, meeting: boolean, mAt: string) => {
    setStage(stageFor(kind, r, happened));
    const f = suggestedFollowUp(kind === "call" ? r : "talked", meeting ? mAt : null);
    setFollowAt(f.due);
    setFollowNote(f.note);
  };

  const chooseFiles = (list: FileList | null) => {
    setMsg(null);
    const all = Array.from(list ?? []);
    const bad = all.find((f) => !/\.(jpe?g|png|webp)$/i.test(f.name));
    const big = all.find((f) => f.size > MAX_BYTES);
    if (bad || big) {
      setWaFiles([]);
      setMsg({ text: bad ? `${bad.name}: upload a JPG, PNG or WebP screenshot.` : `${big!.name} is over 10 MB.`, ok: false });
      return;
    }
    setWaFiles(waKind === "whatsapp_call" ? all.slice(0, 1) : all);
  };

  /** Uploads what is left to upload; a file that went through isn't sent again when the save is retried. */
  const uploadScreenshots = async () => {
    for (let left = waFiles; left.length; left = left.slice(1)) {
      const form = new FormData();
      form.set("file", left[0]);
      form.set("kind", waKind);
      if (waKind === "whatsapp_call") form.set("length", waLength);
      const res = await fetch(`/api/v1/leads/${leadId}/whatsapp`, { method: "POST", body: form }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res?.ok) return json?.error?.message ?? "The screenshot couldn't be uploaded. Try again.";
      setWaFiles(left.slice(1));
      setWaSent(true);
    }
    return null;
  };

  const submit = () =>
    startTransition(async () => {
      setMsg(null);
      if (kind === "whatsapp") {
        if (waFiles.length === 0 && !waSent) return setMsg({ text: "Add the screenshot. It is the record of the conversation.", ok: false });
        if (waKind === "whatsapp_call" && waFiles.length && !waLength.trim()) return setMsg({ text: "Enter the call length shown in the screenshot, e.g. 3:25.", ok: false });
        const failed = await uploadScreenshots();
        if (failed) return setMsg({ text: failed, ok: false });
      }
      const r = await logCallUpdateAction(leadId, {
        result: kind === "call" ? result : "no_call",
        minutes: kind !== "call" || minutes === "" ? null : minutes,
        meetingResult:
          kind === "meeting"
            ? {
                meetingId: unscheduled ? null : picked,
                outcome: happened,
                type: unscheduled ? heldType : null,
                startsAt: unscheduled ? (heldAt ? fromLocalInputValue(heldAt) : "") : happened === "rescheduled" ? (newAt ? fromLocalInputValue(newAt) : "") : null,
              }
            : null,
        note,
        stage: stage === currentStage ? null : stage,
        meeting: meetingOn && !(kind === "meeting" && happened === "rescheduled") ? { type: meetingType, startsAt: meetingAt ? fromLocalInputValue(meetingAt) : "" } : null,
        completeFollowUpIds,
        followUp: followOn ? { dueAt: followAt ? fromLocalInputValue(followAt) : "", note: followNote } : null,
      });
      if (r.ok) {
        const changedStage = stage !== currentStage ? `moved to ${STAGE_LABELS[stage]}` : null;
        const what = { call: "call saved", meeting: { completed: "meeting completed", no_show: "no-show recorded", rescheduled: "meeting rescheduled", cancelled: "meeting cancelled" }[happened], whatsapp: "WhatsApp saved", note: note ? "note saved" : null }[kind];
        const parts = [what, changedStage, meetingOn ? "meeting booked" : null, completeFollowUpIds.length ? (completeFollowUpIds.length > 1 ? `${completeFollowUpIds.length} follow-ups completed` : "follow-up completed") : null, followOn ? "next follow-up set" : null].filter(Boolean).join(", ");
        const text = parts ? `Done: ${parts}.` : "Nothing changed.";
        setMsg({ text, ok: true });
        setWaFiles([]);
        setWaLength("");
        setWaSent(false);
        setMeetingPick("");
        setOutcome("completed");
        setHeldAt(toLocalInputValue(new Date()));
        if (waInput.current) waInput.current.value = "";
        if (parts) onSaved?.(text);
        setErrors({});
        setNote("");
        setMinutes("");
        setMeetingOn(false);
        setTicked([]);
      } else {
        setErrors(r.fields ?? {});
        setMsg({ text: r.message, ok: false });
      }
    });

  return (
    <form
      noValidate
      aria-label="Log activity"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4 rounded-2xl border border-brand/30 bg-white p-5 shadow-hairline"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex size-8 items-center justify-center rounded-xl bg-brand-50 text-brand">
          <PenLine aria-hidden="true" className="size-4" />
        </span>
        <div>
          <h3 className="text-sm font-black">Log activity</h3>
          <p className="text-[11px] text-zinc-500">Say what happened. The stage, Last Contact, meeting and follow-ups are updated in one save.</p>
        </div>
      </div>

      <div role="group" aria-label="Activity" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {KINDS.map(([k, label, Icon]) => (
          <button key={k} type="button" aria-pressed={kind === k} disabled={pending} onClick={() => switchTo(k)} className={cn(chip(kind === k), "flex items-center justify-center gap-1.5 py-2")}>
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {kind === "meeting" ? (
        <div className="space-y-3 rounded-xl border border-zinc-200/80 p-3">
          <Field label="Meeting" error={errors["meetingResult.meetingId"]}>
            {(id, d) => (
              <select
                id={id}
                aria-describedby={d}
                value={picked}
                onChange={(e) => {
                  setMeetingPick(e.target.value);
                  chooseOutcome("completed");
                }}
                className={selectClass}
                disabled={pending}
              >
                {meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} · {formatDateTime(m.startsAt)}
                  </option>
                ))}
                <option value={UNSCHEDULED}>A meeting that wasn&apos;t scheduled</option>
              </select>
            )}
          </Field>
          {unscheduled ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <Field label="Type" error={errors["meetingResult.type"]}>
                {(id) => (
                  <select id={id} value={heldType} onChange={(e) => setHeldType(e.target.value as MeetingType)} className={selectClass} disabled={pending}>
                    {MEETING_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {MEETING_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="When it was held (Pakistan time)" error={errors["meetingResult.startsAt"]}>
                {(id, d) => <DateTimeInput id={id} describedBy={d} invalid={Boolean(errors["meetingResult.startsAt"])} value={heldAt} quick={false} disabled={pending} onChange={setHeldAt} />}
              </Field>
            </div>
          ) : (
            <>
              <div role="group" aria-label="What happened to the meeting" className="flex flex-wrap gap-1.5">
                {OUTCOMES.map(([o, label]) => (
                  <button key={o} type="button" aria-pressed={outcome === o} disabled={pending} onClick={() => chooseOutcome(o)} className={chip(outcome === o)}>
                    {label}
                  </button>
                ))}
              </div>
              {errors["meetingResult.outcome"] ? <p className="text-xs font-semibold text-rose-600">{errors["meetingResult.outcome"]}</p> : null}
              {outcome === "rescheduled" ? (
                <Field label="New time (Pakistan time)" error={errors["meetingResult.startsAt"]}>
                  {(id, d) => <DateTimeInput id={id} describedBy={d} invalid={Boolean(errors["meetingResult.startsAt"])} value={newAt} disabled={pending} defaultTime="11:00" onChange={setNewAt} />}
                </Field>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {kind === "whatsapp" ? (
        <div className="space-y-3 rounded-xl border border-zinc-200/80 p-3">
          <div role="group" aria-label="Screenshot of" className="flex flex-wrap gap-1.5">
            {(
              [
                ["whatsapp_chat", "Chat"],
                ["whatsapp_call", "Call"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={waKind === k}
                disabled={pending}
                onClick={() => {
                  setWaKind(k);
                  setWaFiles([]);
                  if (waInput.current) waInput.current.value = "";
                }}
                className={chip(waKind === k)}
              >
                {label}
              </button>
            ))}
          </div>
          <Field label={waKind === "whatsapp_call" ? "Screenshot of the call" : "Chat screenshots"} required hint="JPG, PNG or WebP, up to 10 MB">
            {(id, d) => (
              <input ref={waInput} id={id} aria-describedby={d} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple={waKind === "whatsapp_chat"} disabled={pending} onChange={(e) => chooseFiles(e.target.files)} className={fileInput} />
            )}
          </Field>
          {waKind === "whatsapp_call" ? (
            <Field label="Call length" required className="max-w-[12rem]">
              {(id, d) => <Input id={id} aria-describedby={d} value={waLength} placeholder="e.g. 3:25" onChange={(e) => setWaLength(e.target.value)} disabled={pending} />}
            </Field>
          ) : null}
        </div>
      ) : null}

      {kind === "call" ? (
      <div role="group" aria-label="Call result" className="flex flex-wrap gap-1.5">
        {CALL_RESULTS.filter((r) => r !== "no_call").map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={result === r}
            onClick={() => {
              setResult(r);
              resuggest(r, meetingOn, meetingAt);
            }}
            className={chip(result === r)}
          >
            {CALL_RESULT_LABELS[r]}
          </button>
        ))}
      </div>
      ) : null}

      <div className={cn("grid grid-cols-1 gap-3", kind === "call" && "sm:grid-cols-[120px_minmax(0,1fr)]")}>
        <Field label="Minutes" error={errors.minutes} className={kind === "call" ? undefined : "hidden"}>
          {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" value={minutes} placeholder="e.g. 4" onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))} disabled={pending} />}
        </Field>
        <Field label="What happened" error={errors.note}>
          {(id, d) => (
            <textarea id={id} aria-describedby={d} rows={2} value={note} maxLength={4000} placeholder="e.g. Interested in 2-bed; will visit the site next week with family" onChange={(e) => setNote(e.target.value)} className={textareaClass} disabled={pending} />
          )}
        </Field>
      </div>

      <Field label="Stage" error={errors.stage} hint={stage === currentStage ? "Unchanged" : `Moves from ${STAGE_LABELS[currentStage]}`}>
        {(id, d) => (
          <select id={id} aria-describedby={d} value={stage} onChange={(e) => setStage(e.target.value as LeadStage)} className={selectClass} disabled={pending}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className={cn("space-y-3 rounded-xl border border-zinc-200/80 p-3", kind === "meeting" && happened === "rescheduled" && "hidden")}>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            className="size-4 accent-[#bb8c08]"
            checked={meetingOn}
            disabled={pending}
            onChange={(e) => {
              setMeetingOn(e.target.checked);
              resuggest(result, e.target.checked, meetingAt);
            }}
          />
          {kind === "meeting" ? "Book another meeting" : "Book a meeting"}
          {wouldMoveLead("schedule", stage) ? <span className="text-[11px] font-medium text-zinc-500">(moves the lead to Meeting scheduled)</span> : null}
        </label>
        {meetingOn ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
            <Field label="Type">
              {(id) => (
                <select id={id} value={meetingType} onChange={(e) => setMeetingType(e.target.value as MeetingType)} className={selectClass} disabled={pending}>
                  {MEETING_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {MEETING_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="When (Pakistan time)" error={errors["meeting.startsAt"]}>
              {(id, d) => (
                <DateTimeInput
                  id={id}
                  describedBy={d}
                  invalid={Boolean(errors["meeting.startsAt"])}
                  value={meetingAt}
                  disabled={pending}
                  defaultTime="11:00"
                  onChange={(v) => {
                    setMeetingAt(v);
                    resuggest(result, true, v);
                  }}
                />
              )}
            </Field>
          </div>
        ) : null}
      </div>

      {pendingFollowUps.length ? (
        <fieldset className="space-y-2 rounded-xl border border-zinc-200/80 p-3">
          <legend className="sr-only">Complete pending follow-ups</legend>
          <p aria-hidden="true" className="text-sm font-bold">
            Complete {pendingFollowUps.length > 1 ? "pending follow-ups" : "the pending follow-up"}
            <span className="ml-2 text-[11px] font-medium text-zinc-500">Tick only what this fulfils</span>
          </p>
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {pendingFollowUps.map((f) => (
              <label key={f.id} className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-[#bb8c08]"
                  checked={ticked.includes(f.id)}
                  disabled={pending}
                  onChange={(e) => setTicked((t) => (e.target.checked ? [...t, f.id] : t.filter((x) => x !== f.id)))}
                />
                <span className="min-w-0">
                  <span className="font-bold">{f.note || "Follow-up"}</span>
                  <span className="ml-2 text-zinc-500">
                    {followUpStatus(f.dueAt, openedAt)} · {formatDateTime(f.dueAt)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="space-y-3 rounded-xl border border-zinc-200/80 p-3">
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="size-4 accent-[#bb8c08]" checked={followOn} disabled={pending} onChange={(e) => setFollowOn(e.target.checked)} />
          Schedule the next follow-up
        </label>
        {followOn ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <Field label="When (Pakistan time)" error={errors["followUp.dueAt"]}>
              {(id, d) => <DateTimeInput id={id} describedBy={d} invalid={Boolean(errors["followUp.dueAt"])} value={followAt} disabled={pending} onChange={setFollowAt} />}
            </Field>
            <Field label="Follow-up for">
              {(id) => (
                <select id={id} value={followNote} onChange={(e) => setFollowNote(e.target.value)} className={selectClass} disabled={pending}>
                  <option value="">No suggestion</option>
                  {FOLLOW_UP_SUGGESTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("mr-auto text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save activity"}
        </Button>
      </div>
    </form>
  );
}
