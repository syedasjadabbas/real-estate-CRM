"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { MiniStat } from "@/components/ui/stat";
import { cn } from "@/lib/cn";
import { ROSTER_STATUSES, ROSTER_STATUS_LABELS, type RosterStatus } from "@/modules/teams/validation";
import { saveRosterAction } from "../actions";

type Row = { id: string; name: string; role?: string; status: RosterStatus | null; checkIn?: string | null; suggested?: RosterStatus | null };

/** FR-122 Day view: a status per member, "Save roster"; locked after 11:00 and for past days (observed). */
export function RosterDayForm({ teamId, date, rows, canEdit, locked, note }: { teamId: string; date: string; rows: Row[]; canEdit: boolean; locked: boolean; note?: string | null }) {
  // A saved status wins; otherwise a check-in suggests In office (15 Nov 2026).
  const [values, setValues] = useState<Record<string, RosterStatus | "">>(() => Object.fromEntries(rows.map((r) => [r.id, r.status ?? r.suggested ?? ""])));
  const suggestedCount = rows.filter((r) => !r.status && r.suggested).length;
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const counts = Object.fromEntries(ROSTER_STATUSES.map((s) => [s, Object.values(values).filter((v) => v === s).length])) as Record<RosterStatus, number>;
  // Easier with a big team (15 Nov 2026): search, quick actions, and a note when there's something to save.
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const shown = rows.filter((r) => !term || r.name.toLowerCase().includes(term));
  const unsaved = rows.some((r) => (r.status ?? "") !== (values[r.id] ?? ""));
  const unmarked = rows.filter((r) => !values[r.id]).length;
  const markCheckedIn = () => setValues((v) => ({ ...v, ...Object.fromEntries(rows.filter((r) => r.checkIn && !v[r.id]).map((r) => [r.id, "in_office" as const])) }));
  const clearAll = () => setValues(Object.fromEntries(rows.map((r) => [r.id, ""])));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ROSTER_STATUSES.map((s) => (
          <MiniStat key={s} label={ROSTER_STATUS_LABELS[s]} value={counts[s]} />
        ))}
      </div>
      {locked ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{note ?? "Locked — view only."}</p> : note ? <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900">{note}</p> : null}
      {canEdit && suggestedCount ? (
        <p className="text-[11px] text-zinc-600">
          {suggestedCount} {suggestedCount === 1 ? "person is" : "people are"} pre-marked In office from their check-in. Save to keep it, or change it first.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search members"
            placeholder="Search members"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-xl border border-zinc-200/80 bg-white px-3 text-xs font-semibold focus:border-brand/50 focus:outline-none"
          />
          {canEdit ? (
            <>
              <Button type="button" variant="secondary" className="h-9 px-3 text-xs" disabled={pending || !rows.some((r) => r.checkIn && !values[r.id])} onClick={markCheckedIn}>
                Checked-in → In office
              </Button>
              <Button type="button" variant="secondary" className="h-9 px-3 text-xs" disabled={pending} onClick={clearAll}>
                Clear all
              </Button>
            </>
          ) : null}
          <span className="text-[11px] text-zinc-500">{unmarked} not marked</span>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="rounded-xl bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500">This team has no members.</p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500">No one matches “{query}”.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200/80">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="min-w-0">
                <span className="font-semibold">{r.name}</span>
                {r.role === "admin" ? <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600">Admin</span> : null}
                <span className="block text-[10px] text-zinc-500">
                  {r.checkIn ? `Checked in ${r.checkIn}` : "No check-in"}
                  {!r.status && r.suggested ? " · pre-marked from check-in" : ""}
                </span>
              </span>
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
        {canEdit && unsaved && !pending ? <p className="text-xs font-semibold text-amber-700">Unsaved changes</p> : null}
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
