"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { applyProposalReconciliationAction } from "../actions";

/** Applies the reconciliation shown above (Q47). Only proposals marked for update change. */
export function ReconciliationApply({ count }: { count: number }) {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
          {msg.text}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        disabled={pending || count === 0}
        onClick={() =>
          startTransition(async () => {
            const r = await applyProposalReconciliationAction();
            setMsg(r.ok ? { text: `${r.data.updated} proposal${r.data.updated === 1 ? "" : "s"} updated. Previous figures are kept in each proposal's history.`, ok: true } : { text: r.message, ok: false });
          })
        }
      >
        {pending ? "Applying…" : `Apply to ${count} proposal${count === 1 ? "" : "s"}`}
      </Button>
    </div>
  );
}
