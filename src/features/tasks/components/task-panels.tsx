"use client";

import { RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { cn } from "@/lib/cn";
import { TASK_STATUSES, TASK_STATUS_LABELS, type TaskStatus } from "@/modules/tasks/constants";
import { rebuildInstallmentsAction, setTaskStatusAction } from "../actions";

function Status({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
      {msg.text}
    </p>
  );
}

/** Status buttons (any status to any other); the server records each change in the history. */
export function TaskStatusPanel({ taskId, status, canEdit }: { taskId: string; status: TaskStatus; canEdit: boolean }) {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <PanelCard title="Status">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Set status">
          {TASK_STATUSES.map((s) => {
            const current = s === status;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={current}
                disabled={!canEdit || pending || current}
                onClick={() =>
                  startTransition(async () => {
                    const result = await setTaskStatusAction(taskId, s);
                    setMsg(result.ok ? { text: `Status set to ${TASK_STATUS_LABELS[s]}.`, ok: true } : { text: result.message, ok: false });
                  })
                }
                className={cn(
                  "rounded-xl border px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed",
                  current ? "border-brand bg-brand text-white shadow-hairline" : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-50",
                )}
              >
                {TASK_STATUS_LABELS[s]}
              </button>
            );
          })}
        </div>
        {!canEdit ? <p className="text-[11px] text-zinc-500">You can view this task but not change it.</p> : null}
        <Status msg={msg} />
      </div>
    </PanelCard>
  );
}

/** Replaces hand-edited rows with the schedule generated from the saved figures. */
export function RebuildRowsButton({ taskId, disabled }: { taskId: string; disabled?: boolean }) {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        className="h-[33px] px-3 text-xs"
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await rebuildInstallmentsAction(taskId);
            setMsg(result.ok ? { text: `Rebuilt ${result.data.rows} rows.`, ok: true } : { text: result.message, ok: false });
          })
        }
      >
        <RotateCcw aria-hidden="true" className="size-3.5" />
        {pending ? "Rebuilding…" : "Rebuild installment rows"}
      </Button>
      <Status msg={msg} />
    </div>
  );
}
