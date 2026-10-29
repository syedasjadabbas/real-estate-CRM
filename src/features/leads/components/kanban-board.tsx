"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { LEAD_STAGES, PRIORITY_LABELS, STAGE_LABELS, type LeadStage } from "@/modules/leads/constants";
import type { LeadListRow } from "@/modules/leads/queries";
import { changeStageAction } from "../actions";
import { formatDateTime } from "../format";

type Column = { stage: LeadStage; total: number; cards: LeadListRow[] };

/** Stages a card can be moved to from the board (Lost/Booked use their own flows). */
const MOVABLE: LeadStage[] = LEAD_STAGES.filter((s) => s !== "lost_lead" && s !== "booked");

function KanbanCard({ card, canEdit, now }: { card: LeadListRow; canEdit: boolean; now: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const overdue = card.nextFollowUpAt && new Date(card.nextFollowUpAt).getTime() < now;
  const locked = card.stage === "booked";

  return (
    <li className={cn("rounded-xl border border-zinc-200/80 bg-white p-3 shadow-hairline", pending && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/dashboard/leads/${card.id}`} className="min-w-0 text-xs leading-4 font-bold hover:text-brand hover:underline">
          {card.name}
        </Link>
        <span className="shrink-0 text-[10px] font-bold tracking-[0.05em] text-zinc-500">{card.code}</span>
      </div>
      <p className="mt-1 text-[11px] text-zinc-600">{card.phone}</p>
      <p className="text-[11px] text-zinc-600">{card.ownerName ?? "Unassigned"}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {card.priority !== "none" ? (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-black tracking-[0.05em] text-zinc-700 uppercase">
            {PRIORITY_LABELS[card.priority]}
          </span>
        ) : null}
        {card.nextFollowUpAt ? (
          <span className={cn("text-[10px] font-semibold", overdue ? "text-rose-600" : "text-zinc-600")}>
            F/U {formatDateTime(card.nextFollowUpAt)}
          </span>
        ) : null}
      </div>
      {canEdit && !locked ? (
        <div className="mt-2">
          <label className="sr-only" htmlFor={`move-${card.id}`}>
            Move {card.name} to stage
          </label>
          <select
            id={`move-${card.id}`}
            value=""
            disabled={pending}
            onChange={(e) => {
              const to = e.target.value as LeadStage;
              if (!to) return;
              startTransition(async () => {
                const result = await changeStageAction(card.id, to);
                setError(result.ok ? null : result.message);
              });
            }}
            className="h-8 w-full rounded-lg border border-zinc-200/80 bg-zinc-50/70 px-2 text-[11px] font-bold text-zinc-700 focus:border-brand/50 focus:outline-none"
          >
            <option value="">Move to…</option>
            {MOVABLE.filter((s) => s !== card.stage).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
          {error ? (
            <p role="alert" className="mt-1 text-[10px] font-semibold text-rose-600">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Horizontally scrolling stage columns. Totals always show the full count. */
export function KanbanBoard({ columns, canEdit, now }: { columns: Column[]; canEdit: boolean; now: number }) {
  return (
    <div className="relative overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3.5">
        {columns.map((col) => (
          <section
            key={col.stage}
            aria-label={`${STAGE_LABELS[col.stage]}: ${col.total} leads`}
            className="flex w-72 shrink-0 flex-col rounded-2xl border border-zinc-200/80 bg-zinc-50/70 shadow-hairline"
          >
            <header className="flex items-center justify-between border-b border-zinc-200/60 px-3.5 py-3">
              <h3 className="text-[11px] font-black tracking-[0.1em] text-zinc-700 uppercase">{STAGE_LABELS[col.stage]}</h3>
              <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-black text-zinc-700 shadow-hairline">{col.total}</span>
            </header>
            <ul className="max-h-[560px] flex-1 space-y-2 overflow-y-auto p-2.5">
              {col.cards.length === 0 ? (
                <li className="rounded-xl border border-dashed border-zinc-200 px-3 py-6 text-center text-[11px] font-semibold text-zinc-400">
                  No leads
                </li>
              ) : (
                col.cards.map((card) => <KanbanCard key={card.id} card={card} canEdit={canEdit} now={now} />)
              )}
            </ul>
            {col.total > col.cards.length ? (
              <p className="border-t border-zinc-200/60 px-3.5 py-2 text-[10px] font-semibold text-zinc-500">
                Showing {col.cards.length} of {col.total} · use Table view or filters for the rest
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
