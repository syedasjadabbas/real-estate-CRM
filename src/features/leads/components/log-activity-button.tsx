"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { LeadStage } from "@/modules/leads/constants";
import type { OpenMeeting } from "@/modules/meetings/open";
import { LogActivityForm, type PendingFollowUp } from "./log-activity-form";

/** The table's one action besides Open (client, 24 Nov 2026): everything that happened is recorded here. */
export function LogActivityButton(props: { leadId: string; leadName: string; stage: LeadStage; pendingFollowUps: PendingFollowUp[]; meetings: OpenMeeting[] }) {
  const { leadId, leadName, stage, pendingFollowUps, meetings } = props;
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSaved(null);
          setOpen(true);
        }}
        aria-label={`Log activity for ${leadName}`}
        className="inline-flex h-8 items-center rounded-lg border border-zinc-200/80 bg-white px-3 text-[11px] font-black whitespace-nowrap text-zinc-800 shadow-hairline hover:bg-zinc-50"
      >
        Log Activity
      </button>
      {saved ? (
        <span role="status" className="text-[10px] font-bold text-brand" title={saved}>
          Saved
        </span>
      ) : null}
      {open ? (
        <Modal open onClose={() => setOpen(false)} title="Log activity" description={leadName} className="max-w-2xl">
          <LogActivityForm
            leadId={leadId}
            currentStage={stage}
            pendingFollowUps={pendingFollowUps}
            meetings={meetings}
            onSaved={(text) => {
              setSaved(text);
              setOpen(false);
            }}
          />
        </Modal>
      ) : null}
    </>
  );
}
