"use client";

import { CalendarPlus, CircleCheck, MoreHorizontal, PhoneCall, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/ui/modal";
import type { LeadStage } from "@/modules/leads/constants";
import { completeNextFollowUpAction } from "../actions";
import { CallUpdateCard } from "./call-update-card";
import { FollowUpDialog } from "./follow-up-dialog";

const WIDTH = 220;
const HEIGHT = 150;

/**
 * The row's other actions behind one ⋯ button (client, 24 Nov 2026). Each item says what it does, and
 * "Mark follow-up done" is there only while a follow-up is pending. Drawn over the page so the table's
 * scroll area can't clip it.
 */
export function LeadRowMenu({ leadId, leadName, stage, hasPending, canLog }: { leadId: string; leadName: string; stage: LeadStage; hasPending: boolean; canLog: boolean }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [dialog, setDialog] = useState<"log" | "followUp" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const shown = pos !== null;

  const toggle = () => {
    setError(null);
    if (shown) return setPos(null);
    const r = button.current!.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - WIDTH, window.innerWidth - WIDTH - 8));
    setPos(window.innerHeight - r.bottom > HEIGHT ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 });
  };

  useEffect(() => {
    if (!shown) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        button.current?.focus();
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    };
    const onPress = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !menu.current?.contains(t)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [shown]);

  const done = () =>
    startTransition(async () => {
      const result = await completeNextFollowUpAction(leadId);
      setError(result.ok ? null : result.message);
    });

  const items: { label: string; icon: LucideIcon; run: () => void }[] = [
    ...(canLog ? [{ label: "Log call", icon: PhoneCall, run: () => setDialog("log") }] : []),
    { label: "Schedule follow-up", icon: CalendarPlus, run: () => setDialog("followUp") },
    ...(hasPending ? [{ label: "Mark follow-up done", icon: CircleCheck, run: done }] : []),
  ];

  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={pending}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={shown}
        aria-controls={shown ? id : undefined}
        aria-label={`More actions for ${leadName}`}
        title="More actions"
        className="inline-flex size-8 items-center justify-center rounded-lg border border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none disabled:opacity-40"
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </button>
      {error ? (
        <span role="alert" className="max-w-[140px] text-[10px] font-semibold whitespace-normal text-rose-600">
          {error}
        </span>
      ) : null}
      {pos
        ? createPortal(
            <div ref={menu} id={id} role="menu" aria-label={`Actions for ${leadName}`} style={{ ...pos, width: WIDTH }} className="fixed z-50 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg">
              {items.map(({ label, icon: Icon, run }) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPos(null);
                    run();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-bold text-zinc-800 hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:outline-none"
                >
                  <Icon aria-hidden="true" className="size-4 text-zinc-400" />
                  {label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
      {dialog === "log" ? (
        <Modal open onClose={() => setDialog(null)} title="Log call" description={leadName} className="max-w-2xl">
          <CallUpdateCard leadId={leadId} currentStage={stage} />
        </Modal>
      ) : null}
      <FollowUpDialog open={dialog === "followUp"} onClose={() => setDialog(null)} leadId={leadId} leadName={leadName} />
    </>
  );
}
