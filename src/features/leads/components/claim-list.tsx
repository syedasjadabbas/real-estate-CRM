"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { PRIORITY_LABELS, type LeadPriority } from "@/modules/leads/constants";
import { claimLeadAction } from "../actions";
import { formatDateTime } from "../format";

type Row = { id: string; code: string; name: string; createdAt: string; priority: LeadPriority; source: string | null };

/** The unassigned pool. Claiming is first come, first served; a lost race says so. */
export function ClaimList({ rows, canClaim }: { rows: Row[]; canClaim: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  return (
    <div className="space-y-3">
      {msg ? (
        <p role="status" className={cn("text-xs font-semibold", msg.ok ? "text-emerald-700" : "text-rose-600")}>
          {msg.text}
        </p>
      ) : null}
      <ul className="space-y-2" aria-label="Unassigned leads">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 shadow-hairline">
            <div className="min-w-0">
              <p className="text-sm font-bold text-zinc-900">
                {r.name} <span className="font-semibold tracking-[0.05em] text-zinc-500">· {r.code}</span>
              </p>
              <p className="text-[11px] text-zinc-500">
                {formatDateTime(r.createdAt)}
                {r.source ? ` · ${r.source}` : ""}
                {r.priority !== "none" ? ` · ${PRIORITY_LABELS[r.priority]} priority` : ""}
              </p>
            </div>
            {canClaim ? (
              <Button
                variant="primary"
                size="lg"
                disabled={pending}
                aria-label={`Claim ${r.name}`}
                onClick={() =>
                  startTransition(async () => {
                    const result = await claimLeadAction(r.id);
                    if (result.ok) router.push(`/dashboard/leads/${r.id}`);
                    else setMsg({ text: result.message, ok: false });
                  })
                }
              >
                Claim
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
