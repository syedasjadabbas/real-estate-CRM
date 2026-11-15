"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { setProjectArchivedAction, setUnitArchivedAction } from "../actions";

/**
 * Archive / restore (owner, 16 Nov 2026), Super Admin only. Archiving hides the project or unit
 * everywhere; leads, bookings, payments and history keep it, and it can be restored.
 */
export function ArchivePanel({
  kind,
  id,
  archivedAt,
  blockedNote,
}: {
  kind: "project" | "unit";
  id: string;
  archivedAt: Date | null;
  /** Shown instead of the Restore button (a unit whose project is archived). */
  blockedNote?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const noun = kind === "project" ? "project" : "unit";

  const run = (archive: boolean) =>
    startTransition(async () => {
      const result = kind === "project" ? await setProjectArchivedAction(id, archive) : await setUnitArchivedAction(id, archive);
      setConfirming(false);
      setMsg(result.ok ? { text: archive ? `The ${noun} is archived.` : `The ${noun} is restored.`, ok: true } : { text: result.message, ok: false });
    });

  return (
    <PanelCard title="Archive">
      <div className="space-y-3">
        {archivedAt ? (
          <>
            <p className="text-xs text-zinc-600">
              Archived on <span className="font-semibold">{formatDateTime(archivedAt)}</span>. It is hidden everywhere; its history is kept.
            </p>
            {blockedNote ? (
              <p className="text-xs text-zinc-500">{blockedNote}</p>
            ) : (
              <Button variant="secondary" size="lg" disabled={pending} onClick={() => run(false)}>
                <ArchiveRestore aria-hidden="true" className="size-4" />
                Restore {noun}
              </Button>
            )}
          </>
        ) : confirming ? (
          <>
            <p className="text-xs text-zinc-600">
              {kind === "project"
                ? "Archive this project? It and its units disappear from lists, the project selector, new leads and bookings. Existing leads, bookings and payments keep it. You can restore it later."
                : "Archive this unit? It disappears from inventory, bookings and proposals. Its bookings and history are kept. You can restore it later."}
            </p>
            <div className="flex gap-2">
              <Button variant="primary" size="lg" disabled={pending} onClick={() => run(true)}>
                Yes, archive
              </Button>
              <Button variant="secondary" size="lg" disabled={pending} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-zinc-500">Hide this {noun} everywhere without deleting anything. It can be restored.</p>
            <Button variant="secondary" size="lg" onClick={() => setConfirming(true)}>
              <Archive aria-hidden="true" className="size-4" />
              Archive {noun}
            </Button>
          </>
        )}
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </PanelCard>
  );
}
