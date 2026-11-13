"use client";

import { GripVertical, Phone } from "lucide-react";
import { telHref } from "@/modules/leads/phone";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import { LEAD_STAGES, PRIORITY_LABELS, STAGE_LABELS, type LeadStage } from "@/modules/leads/constants";
import type { LeadListRow } from "@/modules/leads/queries";
import { changeStageAction } from "../actions";
import { formatDateTime } from "../format";

type Column = { stage: LeadStage; total: number; cards: LeadListRow[] };
type Drag = { card: LeadListRow; x: number; y: number; over: LeadStage | null };

/** Stages a card can be moved to from the board (Lost/Booked use their own flows). */
const MOVABLE: LeadStage[] = LEAD_STAGES.filter((s) => s !== "lost_lead" && s !== "booked");
/** Pixels the pointer must travel before a press on the handle becomes a drag. */
const DRAG_THRESHOLD = 6;
const EDGE = 48;

function KanbanCard({
  card,
  canEdit,
  now,
  pending,
  error,
  onMove,
  onDragStart,
  dragging,
}: {
  card: LeadListRow;
  canEdit: boolean;
  now: number;
  pending: boolean;
  error: string | null;
  onMove: (card: LeadListRow, to: LeadStage) => void;
  onDragStart: (card: LeadListRow, e: ReactPointerEvent<HTMLButtonElement>) => void;
  dragging: boolean;
}) {
  const overdue = card.nextFollowUpAt && new Date(card.nextFollowUpAt).getTime() < now;
  const locked = card.stage === "booked";
  const movable = canEdit && !locked;

  return (
    <li className={cn("rounded-xl border border-zinc-200/80 bg-white p-3 shadow-hairline", (pending || dragging) && "opacity-50")}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-1">
          {movable ? (
            <button
              type="button"
              aria-label={`Drag ${card.name} to another stage`}
              title="Drag to another stage"
              onPointerDown={(e) => onDragStart(card, e)}
              className="-ml-1 shrink-0 cursor-grab touch-none rounded-md p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 active:cursor-grabbing"
            >
              <GripVertical aria-hidden="true" className="size-4" />
            </button>
          ) : null}
          <Link href={`/dashboard/leads/${card.id}`} className="min-w-0 text-xs leading-4 font-bold hover:text-brand hover:underline">
            {card.name}
          </Link>
        </span>
        <span className="shrink-0 text-[10px] font-bold tracking-[0.05em] text-zinc-500">{card.code}</span>
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-600">
        <a
          href={telHref(card.phoneCountryCode, card.phoneNumber)}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand ring-1 ring-brand/20 transition-colors hover:bg-brand hover:text-white"
          aria-label={`Call ${card.name} on ${card.phone}`}
          title={`Call ${card.phone}`}
        >
          <Phone aria-hidden="true" className="size-3" />
        </a>
        {card.phone}
      </p>
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
      {movable ? (
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
              if (to) onMove(card, to);
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
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-[10px] font-semibold text-rose-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Horizontally scrolling stage columns (FR-023). Cards move by dragging their handle (mouse, touch
 * or pen, using pointer events) or with the "Move to…" menu. Both call the same server action, so
 * permissions, stage rules and the audit trail are the server's. Totals always show the full count.
 */
export function KanbanBoard({ columns, canEdit, now }: { columns: Column[]; canEdit: boolean; now: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [announce, setAnnounce] = useState("");
  const [, startTransition] = useTransition();

  const move = (card: LeadListRow, to: LeadStage) => {
    if (to === card.stage) return;
    if (!MOVABLE.includes(to)) {
      setErrors((e) => ({
        ...e,
        [card.id]: to === "lost_lead" ? "Mark a lead lost from its page (a reason is required)." : "Booked is set by the lead's booking.",
      }));
      return;
    }
    setPending(card.id);
    startTransition(async () => {
      const result = await changeStageAction(card.id, to);
      setPending(null);
      setErrors((e) => ({ ...e, [card.id]: result.ok ? null : result.message }));
      setAnnounce(result.ok ? `${card.name} moved to ${STAGE_LABELS[to]}.` : `${card.name} was not moved: ${result.message}`);
    });
  };

  // Pointer tracking for the active drag (document-level so the pointer can leave the handle).
  const press = useRef<{ card: LeadListRow; x: number; y: number; started: boolean } | null>(null);
  useEffect(() => {
    const stageAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-stage]") as HTMLElement | null)?.dataset.stage as LeadStage | undefined;
    const onMoveEvt = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!p.started && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
      p.started = true;
      e.preventDefault();
      setDrag({ card: p.card, x: e.clientX, y: e.clientY, over: stageAt(e.clientX, e.clientY) ?? null });
      const box = scroller.current?.getBoundingClientRect();
      if (scroller.current && box) {
        if (e.clientX < box.left + EDGE) scroller.current.scrollLeft -= 12;
        else if (e.clientX > box.right - EDGE) scroller.current.scrollLeft += 12;
      }
    };
    const onUp = (e: PointerEvent) => {
      const p = press.current;
      press.current = null;
      if (!p?.started) return setDrag(null);
      const to = stageAt(e.clientX, e.clientY);
      setDrag(null);
      if (to) move(p.card, to);
    };
    const onCancel = () => {
      press.current = null;
      setDrag(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("pointermove", onMoveEvt, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointermove", onMoveEvt);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onKey);
    };
    // `move` only uses state setters and the server action, which never change between renders.
  }, []);

  const onDragStart = (card: LeadListRow, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    press.current = { card, x: e.clientX, y: e.clientY, started: false };
  };

  return (
    <div ref={scroller} className="relative overflow-x-auto pb-2">
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="flex min-w-max gap-3.5">
        {columns.map((col) => {
          const target = drag && drag.over === col.stage && drag.card.stage !== col.stage;
          const blocked = target && !MOVABLE.includes(col.stage);
          return (
            <section
              key={col.stage}
              data-stage={col.stage}
              aria-label={`${STAGE_LABELS[col.stage]}: ${col.total} leads`}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-2xl border border-zinc-200/80 bg-zinc-50/70 shadow-hairline transition-colors",
                target && !blocked && "border-brand/50 bg-brand-50/60",
                blocked && "border-rose-300 bg-rose-50/60",
              )}
            >
              <header className="flex items-center justify-between border-b border-zinc-200/60 px-3.5 py-3">
                <h3 className="text-[11px] font-black tracking-[0.1em] text-zinc-700 uppercase">{STAGE_LABELS[col.stage]}</h3>
                <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-black text-zinc-700 shadow-hairline">{col.total}</span>
              </header>
              <ul className="max-h-[560px] flex-1 space-y-2 overflow-y-auto p-2.5">
                {col.cards.length === 0 ? (
                  <li className="rounded-xl border border-dashed border-zinc-200 px-3 py-6 text-center text-[11px] font-semibold text-zinc-400">No leads</li>
                ) : (
                  col.cards.map((card) => (
                    <KanbanCard
                      key={card.id}
                      card={card}
                      canEdit={canEdit}
                      now={now}
                      pending={pending === card.id}
                      error={errors[card.id] ?? null}
                      onMove={move}
                      onDragStart={onDragStart}
                      dragging={drag?.card.id === card.id}
                    />
                  ))
                )}
              </ul>
              {col.total > col.cards.length ? (
                <p className="border-t border-zinc-200/60 px-3.5 py-2 text-[10px] font-semibold text-zinc-500">
                  Showing {col.cards.length} of {col.total} · use Table view or filters for the rest
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
      {drag ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 w-60 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-brand/40 bg-white p-2.5 text-xs font-bold shadow-lg"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.card.name}
          <span className="block text-[10px] font-semibold text-zinc-500">
            {drag.over && drag.over !== drag.card.stage
              ? MOVABLE.includes(drag.over)
                ? `Drop to move to ${STAGE_LABELS[drag.over]}`
                : `${STAGE_LABELS[drag.over]} is set from the lead page`
              : "Drag onto a stage"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
