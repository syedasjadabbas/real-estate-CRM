"use client";

import { PhoneCall } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DateTimeInput } from "@/components/ui/date-time-input";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { CALL_RESULTS, CALL_RESULT_LABELS, type CallResult } from "@/modules/leads/call-results";
import { LEAD_STAGES, STAGE_LABELS, type LeadStage } from "@/modules/leads/constants";
import { MEETING_TYPES, MEETING_TYPE_LABELS, type MeetingType } from "@/modules/meetings/constants";
import { logCallUpdateAction } from "../actions";
import { fromLocalInputValue, toLocalInputValue } from "../format";
import { FOLLOW_UP_SUGGESTIONS, textareaClass } from "./follow-up-dialog";
import { selectClass } from "./lead-fields";

const STAGES = LEAD_STAGES.filter((s) => s !== "booked" && s !== "lost_lead");
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

/**
 * "Update after call" (owner, 14 Nov 2026): record a call and everything it decided in one save:
 * the call and what was said, the stage, a meeting and the next follow-up.
 */
export function CallUpdateCard({ leadId, currentStage }: { leadId: string; currentStage: LeadStage }) {
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const resuggest = (r: CallResult, meeting: boolean, mAt: string) => {
    setStage(suggestedStage(r, currentStage));
    const f = suggestedFollowUp(r, meeting ? mAt : null);
    setFollowAt(f.due);
    setFollowNote(f.note);
  };

  const submit = () =>
    startTransition(async () => {
      setMsg(null);
      const r = await logCallUpdateAction(leadId, {
        result,
        minutes: minutes === "" ? null : minutes,
        note,
        stage: stage === currentStage ? null : stage,
        meeting: meetingOn ? { type: meetingType, startsAt: meetingAt ? fromLocalInputValue(meetingAt) : "" } : null,
        followUp: followOn ? { dueAt: followAt ? fromLocalInputValue(followAt) : "", note: followNote } : null,
      });
      if (r.ok) {
        const changedStage = stage !== currentStage ? `moved to ${STAGE_LABELS[stage]}` : null;
        const parts = [result === "no_call" ? (note ? "note saved" : null) : "call saved", changedStage, meetingOn ? "meeting booked" : null, followOn ? "next follow-up set" : null].filter(Boolean).join(", ");
        setMsg({ text: parts ? `Done: ${parts}.` : "Nothing changed.", ok: true });
        setErrors({});
        setNote("");
        setMinutes("");
        setMeetingOn(false);
      } else {
        setErrors(r.fields ?? {});
        setMsg({ text: r.message, ok: false });
      }
    });

  return (
    <form
      noValidate
      aria-label="Update after call"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4 rounded-2xl border border-brand/30 bg-white p-5 shadow-hairline"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex size-8 items-center justify-center rounded-xl bg-brand-50 text-brand">
          <PhoneCall aria-hidden="true" className="size-4" />
        </span>
        <div>
          <h3 className="text-sm font-black">Update after call</h3>
          <p className="text-[11px] text-zinc-500">Call, stage, notes, meeting and next follow-up in one save. Choose “No call” to update without a call.</p>
        </div>
      </div>

      <div role="group" aria-label="Call result" className="flex flex-wrap gap-1.5">
        {CALL_RESULTS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={result === r}
            onClick={() => {
              setResult(r);
              resuggest(r, meetingOn, meetingAt);
            }}
            className={cn(
              "rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors",
              result === r ? "border-brand bg-brand text-white" : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50",
            )}
          >
            {CALL_RESULT_LABELS[r]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
        <Field label="Minutes" error={errors.minutes} className={result === "no_call" ? "hidden" : undefined}>
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

      <div className="space-y-3 rounded-xl border border-zinc-200/80 p-3">
        <label className="flex items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            className="size-4 accent-[#107c41]"
            checked={meetingOn}
            disabled={pending}
            onChange={(e) => {
              setMeetingOn(e.target.checked);
              resuggest(result, e.target.checked, meetingAt);
            }}
          />
          Book a meeting
          <span className="text-[11px] font-medium text-zinc-500">(moves the lead to Meeting scheduled)</span>
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

      <div className="space-y-3 rounded-xl border border-zinc-200/80 p-3">
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="size-4 accent-[#107c41]" checked={followOn} disabled={pending} onChange={(e) => setFollowOn(e.target.checked)} />
          Next follow-up
          <span className="text-[11px] font-medium text-zinc-500">(closes the follow-ups due now)</span>
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
          {pending ? "Saving…" : "Save update"}
        </Button>
      </div>
    </form>
  );
}
