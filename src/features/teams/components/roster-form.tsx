"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { MiniStat } from "@/components/ui/stat";
import { cn } from "@/lib/cn";
import { ROSTER_STATUSES, ROSTER_STATUS_LABELS, type RosterStatus } from "@/modules/teams/validation";
import { saveRosterAction } from "../actions";

type Row = { id: string; name: string; status: RosterStatus | null };

/** FR-122 Day view: a status per member, "Save roster"; locked after 11:00 and for past days (observed). */
export function RosterDayForm({ teamId, date, rows, canEdit, locked }: { teamId: string; date: string; rows: Row[]; canEdit: boolean; locked: boolean }) {
  const [values, setValues] = useState<Record<string, RosterStatus | "">>(() => Object.fromEntries(rows.map((r) => [r.id, r.status ?? ""])));
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const counts = Object.fromEntries(ROSTER_STATUSES.map((s) => [s, Object.values(values).filter((v) => v === s).length])) as Record<RosterStatus, number>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ROSTER_STATUSES.map((s) => (
          <MiniStat key={s} label={ROSTER_STATUS_LABELS[s]} value={counts[s]} />
        ))}
      </div>
      {locked ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Locked after 11:00 — view only.</p> : null}
      {rows.length === 0 ? (
        <p className="rounded-xl bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500">This team has no members.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200/80">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="font-semibold">{r.name}</span>
              <div role="radiogroup" aria-label={`${r.name} duty`} className="flex flex-wrap gap-1">
                {ROSTER_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={values[r.id] === s}
                    disabled={!canEdit || pending}
                    onClick={() => setValues((v) => ({ ...v, [r.id]: v[r.id] === s ? "" : s }))}
                    className={cn(
                      "rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors disabled:cursor-not-allowed",
                      values[r.id] === s ? "border-brand bg-brand text-white" : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-60",
                    )}
                  >
                    {ROSTER_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
        {canEdit ? (
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            className="px-4"
            onClick={() =>
              startTransition(async () => {
                const entries = rows.map((r) => ({ userId: r.id, status: values[r.id] || null }));
                const result = await saveRosterAction(teamId, date, entries);
                setMsg(result.ok ? { text: result.data.changed ? "Roster saved." : "No changes to save.", ok: true } : { text: result.message, ok: false });
              })
            }
          >
            {pending ? "Saving…" : "Save roster"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
