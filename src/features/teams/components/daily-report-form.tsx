"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { saveDailyReportAction } from "../actions";

type Row = { agentId: string; name: string; inTeam: boolean; leads: number; calls: number; meetings: number; tokens: number; bookings: number; remarks: string };
const COUNTS = ["leads", "calls", "meetings", "tokens", "bookings"] as const;
const LABELS: Record<(typeof COUNTS)[number], string> = { leads: "Leads", calls: "Calls", meetings: "Meetings", tokens: "Tokens", bookings: "Bookings" };

/** FR-121 agent entries (manual, Q-H3 default). Editable on the report date only (T-A4). */
export function DailyReportForm({
  teamId,
  date,
  rows,
  canEdit,
  lockedReason,
  submitted,
}: {
  teamId: string;
  date: string;
  rows: Row[];
  canEdit: boolean;
  lockedReason: string | null;
  submitted: { by: string | null; at: Date } | null;
}) {
  type EditRow = Omit<Row, (typeof COUNTS)[number]> & Record<(typeof COUNTS)[number], string>;
  const [values, setValues] = useState<EditRow[]>(() =>
    rows.map((r) => ({ agentId: r.agentId, name: r.name, inTeam: r.inTeam, remarks: r.remarks, leads: String(r.leads), calls: String(r.calls), meetings: String(r.meetings), tokens: String(r.tokens), bookings: String(r.bookings) })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const edit = (i: number, patch: Record<string, string>) => setValues((v) => v.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const disabled = !canEdit || pending;

  if (rows.length === 0) return <p className="rounded-xl bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500">This team has no agents.</p>;

  return (
    <form
      noValidate
      aria-label="Daily report"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const lines = values.filter((r) => r.inTeam || COUNTS.some((k) => Number(r[k]) > 0) || r.remarks).map((r) => ({ agentId: r.agentId, ...Object.fromEntries(COUNTS.map((k) => [k, r[k]])), remarks: r.remarks }));
          const result = await saveDailyReportAction(teamId, date, lines);
          if (result.ok) {
            setErrors({});
            setMsg({ text: "Daily report saved.", ok: true });
          } else {
            setErrors(result.fields ?? {});
            setMsg({ text: Object.values(result.fields ?? {})[0] ?? result.message, ok: false });
          }
        });
      }}
    >
      {!canEdit && lockedReason ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{lockedReason} View only.</p> : null}
      <div className="overflow-auto rounded-xl border border-zinc-200/80">
        <table className="w-full min-w-[720px] border-collapse text-left text-xs">
          <thead className="bg-zinc-100">
            <tr className="text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
              <th scope="col" className="px-3 py-2.5">Agent</th>
              {COUNTS.map((k) => (
                <th key={k} scope="col" className="w-20 px-2 py-2.5 text-right">
                  {LABELS[k]}
                </th>
              ))}
              <th scope="col" className="px-2 py-2.5">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {values.map((r, i) => (
              <tr key={r.agentId} className="border-t border-zinc-100">
                <td className="px-3 py-1.5 font-semibold">
                  {r.name}
                  {!r.inTeam ? <span className="block text-[10px] font-medium text-zinc-500">No longer in team</span> : null}
                </td>
                {COUNTS.map((k) => (
                  <td key={k} className="px-1 py-1">
                    <input
                      aria-label={`${r.name} ${LABELS[k]}`}
                      inputMode="numeric"
                      value={r[k]}
                      disabled={disabled}
                      onChange={(e) => edit(i, { [k]: e.target.value.replace(/[^\d]/g, "") })}
                      className="h-8 w-full rounded-lg border border-zinc-200/80 bg-white px-2 text-right text-xs font-semibold tabular-nums focus:border-brand/50 focus:outline-none disabled:bg-zinc-50"
                    />
                  </td>
                ))}
                <td className="px-1 py-1">
                  <input
                    aria-label={`${r.name} remarks`}
                    value={r.remarks}
                    maxLength={500}
                    disabled={disabled}
                    onChange={(e) => edit(i, { remarks: e.target.value })}
                    className="h-8 w-full min-w-[160px] rounded-lg border border-zinc-200/80 bg-white px-2 text-xs focus:border-brand/50 focus:outline-none disabled:bg-zinc-50"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-zinc-500">{submitted ? `Last saved by ${submitted.by ?? "—"} · ${formatDateTime(submitted.at)}` : "Not submitted yet."}</p>
        <div className="flex items-center gap-3">
          {msg ? (
            <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
              {msg.text}
            </p>
          ) : null}
          {canEdit ? (
            <Button type="submit" variant="primary" disabled={pending} className="px-4">
              {pending ? "Saving…" : "Save report"}
            </Button>
          ) : null}
        </div>
      </div>
      {Object.keys(errors).length && !msg ? <p className="text-xs text-rose-600">Check the entries.</p> : null}
    </form>
  );
}
