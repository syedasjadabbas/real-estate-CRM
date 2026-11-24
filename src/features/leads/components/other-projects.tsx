"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const WIDTH = 240;
const MAX_HEIGHT = 260;

/**
 * "+3 projects" under a lead's project; hovering, focusing or tapping it lists the names (client, 24 Nov
 * 2026). Drawn over the page so the table's scroll area can't clip it, and it scrolls itself, so a customer
 * with many enquiries never makes the row taller.
 */
export function OtherProjects({ names, customer }: { names: string[]; customer: string }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const keep = () => {
    if (closing.current) clearTimeout(closing.current);
  };
  const open = () => {
    keep();
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    // Below the button, or above it when there isn't room.
    setPos(window.innerHeight - r.bottom > MAX_HEIGHT ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 });
  };
  // A short wait lets the pointer move from the button into the list.
  const closeSoon = () => {
    keep();
    closing.current = setTimeout(() => setPos(null), 150);
  };

  const shown = pos !== null;
  useEffect(() => {
    if (!shown) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Element && e.target.id === id)) close();
    };
    const onPress = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!button.current?.contains(t) && !t.closest?.(`[id="${id}"]`)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [shown, id]);
  useEffect(() => () => keep(), []);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={shown}
        aria-controls={shown ? id : undefined}
        aria-label={`${customer} is interested in ${names.length} more ${names.length === 1 ? "project" : "projects"}`}
        onPointerEnter={(e) => e.pointerType === "mouse" && open()}
        onPointerLeave={(e) => e.pointerType === "mouse" && closeSoon()}
        onFocus={open}
        onBlur={closeSoon}
        onClick={open}
        className="mt-1 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] leading-4 font-bold text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
      >
        +{names.length} {names.length === 1 ? "project" : "projects"}
        <ChevronDown aria-hidden="true" className="size-3" />
      </button>
      {pos
        ? createPortal(
            <div
              id={id}
              onPointerEnter={keep}
              onPointerLeave={closeSoon}
              style={{ ...pos, width: WIDTH, maxHeight: MAX_HEIGHT }}
              className="fixed z-50 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-2 text-xs shadow-lg"
            >
              <p className="px-2 pb-1 text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">Also interested in</p>
              <ul>
                {names.map((n) => (
                  <li key={n} className="rounded-lg px-2 py-1.5 font-semibold text-zinc-700">
                    {n}
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
