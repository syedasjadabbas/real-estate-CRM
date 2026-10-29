"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Accessible modal dialog: portal, backdrop, Escape to close, focus moved into the panel
 * and restored on close. `side="right"` renders the reference's filter drawer layout.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  side = "center",
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  side?: "center" | "right";
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-zinc-950/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-full flex-col bg-white shadow-2xl shadow-zinc-950/10 focus:outline-none",
          side === "right"
            ? "ml-auto h-full w-full max-w-md border-l border-zinc-200/80"
            : "m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-zinc-200/80",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-6 py-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg leading-7 font-black tracking-[-0.025em]">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-0.5 text-sm text-zinc-600">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center gap-1 rounded-xl border border-zinc-200/80 bg-white px-2.5 text-xs font-bold text-zinc-700 shadow-hairline hover:bg-zinc-50"
          >
            <X aria-hidden="true" className="size-3.5" />
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
