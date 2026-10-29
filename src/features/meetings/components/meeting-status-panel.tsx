"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { cn } from "@/lib/cn";
import { STAGE_LABELS, type LeadStage } from "@/modules/leads/constants";
import { MEETING_STATUS_LABELS, wouldMoveLead, type MeetingStatus } from "@/modules/meetings/constants";
import { cancelMeetingAction, completeMeetingAction } from "../actions";

/**
 * Scheduled → Completed (optional note + D1 checkbox "Also move lead to Meeting Done") or
 * Cancelled (optional note). Completed and cancelled meetings are final (M-A5).
 */
export function MeetingStatusPanel({ meetingId, status, leadStage, canEdit }: { meetingId: string; status: MeetingStatus; leadStage: LeadStage | null; canEdit: boolean }) {
  const [note, setNote] = useState("");
  const [moveLead, setMoveLead] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const movable = leadStage ? wouldMoveLead("complete", leadStage) : false;

  if (status !== "scheduled") {
    return (
      <PanelCard title="Status">
        <div className="space-y-2">
          {/* Keeps the confirmation visible after the page refreshes into the final state. */}
          {msg?.ok ? (
            <p role="status" className="text-xs font-semibold text-brand">
              {msg.text}
            </p>
          ) : null}
          <p className="text-xs text-zinc-600">This meeting is {MEETING_STATUS_LABELS[status].toLowerCase()}. Completed and cancelled meetings can&apos;t be changed.</p>
        </div>
      </PanelCard>
    );
  }
  if (!canEdit) {
    return (
      <PanelCard title="Status">
        <p className="text-xs text-zinc-600">You can view this meeting but not change it.</p>
      </PanelCard>
    );
  }

  const act = (kind: "complete" | "cancel") =>
    startTransition(async () => {
      const result = kind === "complete" ? await completeMeetingAction(meetingId, { note, moveLead: moveLead && movable }) : await cancelMeetingAction(meetingId, { note });
      if (!result.ok) return setMsg({ text: result.message, ok: false });
      const moved = kind === "complete" && (result.data as { movedLead?: boolean }).movedLead;
      setMsg({ text: kind === "complete" ? `Meeting completed${moved ? "; lead moved to Meeting Done" : ""}.` : "Meeting cancelled.", ok: true });
    });

  return (
    <PanelCard title="Status">
      <div className="space-y-3">
        <Field label="Note (optional)">
          {(id) => <textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Outcome or reason" className={textareaClass} disabled={pending} maxLength={1000} />}
        </Field>
        {leadStage ? (
          <label className="flex items-start gap-2 text-xs font-semibold text-zinc-800">
            <input type="checkbox" className="mt-0.5 size-4 accent-[#107c41]" checked={moveLead && movable} disabled={!movable || pending} onChange={(e) => setMoveLead(e.target.checked)} />
            <span>
              On completion, also move lead to Meeting Done
              <span className="block text-[11px] font-medium text-zinc-500">
                {movable ? `Currently ${STAGE_LABELS[leadStage]}.` : `Not available: the lead is ${STAGE_LABELS[leadStage]}.`}
              </span>
            </span>
          </label>
        ) : (
          <p className="text-[11px] text-zinc-500">The linked lead is outside your access, so its stage won&apos;t be changed.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" disabled={pending} onClick={() => act("complete")} className="px-4">
            {pending ? "Saving…" : "Mark completed"}
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => act("cancel")} className="px-4">
            Cancel meeting
          </Button>
        </div>
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </PanelCard>
  );
}
