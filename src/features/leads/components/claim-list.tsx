"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { PRIORITY_LABELS, type LeadPriority } from "@/modules/leads/constants";
import { assignLeadAction, claimLeadAction } from "../actions";
import { formatDateTime } from "../format";
import { LeadPicker } from "./lead-picker";

type Row = { id: string; code: string; name: string; createdAt: string; priority: LeadPriority; source: string | null };
type Owner = { id: string; name: string };

/**
 * The unassigned pool (owner, 16 Nov 2026). Agents claim a lead: first come, first served, and a lost
 * race says so. Admins and Super Admins open the lead or assign it to someone from the row. A search
 * box narrows the list by name, code or source.
 */
export function ClaimList({ rows, canClaim, owners = [], limited = false }: { rows: Row[]; canClaim: boolean; owners?: Owner[]; limited?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [find, setFind] = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const pickerId = useId();
  const canAssign = owners.length > 0;
  const term = find.trim().toLowerCase();
  const shown = term ? rows.filter((r) => `${r.name} ${r.code} ${r.source ?? ""}`.toLowerCase().includes(term)) : rows;
  const ownerOptions = owners.map((o) => ({ value: o.id, label: o.name }));

  const assign = (row: Row) =>
    startTransition(async () => {
      const result = await assignLeadAction(row.id, ownerId);
      if (result.ok) {
        const name = owners.find((o) => o.id === ownerId)?.name ?? "them";
        setMsg({ text: `${row.name} is now assigned to ${name}.`, ok: true });
        setAssigning(null);
        setOwnerId("");
        router.refresh();
      } else setMsg({ text: result.message, ok: false });
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Search name, code or source"
          aria-label="Search unassigned leads"
          className="h-10 w-full max-w-xs rounded-xl border border-zinc-200/80 bg-white px-3 text-xs font-semibold shadow-hairline focus:border-brand/50 focus:outline-none"
        />
        <p className="text-xs text-zinc-500">
          {term ? `${shown.length} of ${rows.length}` : rows.length} unassigned{limited ? " (the oldest 200 are listed)" : ""}
        </p>
      </div>
      {msg ? (
        <p role="status" className={cn("text-xs font-semibold", msg.ok ? "text-emerald-700" : "text-rose-600")}>
          {msg.text}
        </p>
      ) : null}
      {shown.length === 0 ? <p className="text-sm text-zinc-500">No unassigned lead matches “{find.trim()}”.</p> : null}
      <ul className="space-y-2" aria-label="Unassigned leads">
        {shown.map((r) => (
          <li key={r.id} className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 shadow-hairline">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-zinc-900">
                  {canAssign ? (
                    <Link href={`/dashboard/leads/${r.id}`} className="hover:text-brand hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}{" "}
                  <span className="font-semibold tracking-[0.05em] text-zinc-500">· {r.code}</span>
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
              {canAssign && assigning !== r.id ? (
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={pending}
                  aria-label={`Assign ${r.name}`}
                  onClick={() => {
                    setAssigning(r.id);
                    setOwnerId("");
                    setMsg(null);
                  }}
                >
                  Assign
                </Button>
              ) : null}
            </div>
            {canAssign && assigning === r.id ? (
              <div className="mt-3 flex flex-col gap-2 border-t border-zinc-100 pt-3">
                <label htmlFor={pickerId} className="text-[11px] font-bold text-zinc-600">
                  Assign {r.name} to
                </label>
                <LeadPicker
                  id={pickerId}
                  value={ownerId}
                  onChange={setOwnerId}
                  options={ownerOptions}
                  empty="Choose a person…"
                  disabled={pending}
                  noun="people"
                  placeholder="Find a person"
                />
                <div className="flex gap-2">
                  <Button variant="primary" size="lg" disabled={!ownerId || pending} onClick={() => assign(r)}>
                    {pending ? "Assigning…" : "Assign"}
                  </Button>
                  <Button variant="secondary" size="lg" disabled={pending} onClick={() => setAssigning(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
