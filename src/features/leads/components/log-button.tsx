"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { LeadStage } from "@/modules/leads/constants";
import { CallUpdateCard } from "./call-update-card";

/** Logs a call or update from the leads list: the lead page's "Update after call" form in a dialog. */
export function LogButton({ leadId, leadName, stage, disabled }: { leadId: string; leadName: string; stage: LeadStage; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={`Log an interaction with ${leadName}`}
        className="rounded-lg border border-brand bg-brand px-2.5 py-1 text-[10px] leading-[13px] font-black tracking-[0.025em] text-white uppercase transition-colors hover:bg-brand-700 disabled:opacity-40"
      >
        Log
      </button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title="Log interaction" description={leadName} className="max-w-2xl">
          <CallUpdateCard leadId={leadId} currentStage={stage} />
        </Modal>
      ) : null}
    </>
  );
}
