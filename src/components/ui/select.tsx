"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export type SelectOption = { value: string; label: string; disabled?: boolean };

/**
 * Listbox dropdown matching the reference (button with chevron, floating option list with ✓).
 * Keyboard: Enter/Space/ArrowDown open, arrows move, Enter selects, Escape closes.
 */
export function Select({
  options,
  value,
  onChange,
  placeholder = "Select…",
  label,
  emptyMessage = "No options",
  disabled,
  className,
  buttonClassName,
}: {
  options: SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name when no visible label is associated. */
  label: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  const openList = () => {
    if (disabled) return;
    const index = options.findIndex((o) => o.value === value);
    setActive(index >= 0 ? index : 0);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const onButtonKey = (event: KeyboardEvent) => {
    if (["ArrowDown", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openList();
    }
  };

  const onListKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onButtonKey}
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-sm font-medium transition-colors hover:bg-zinc-100/70 disabled:cursor-not-allowed disabled:opacity-60",
          buttonClassName,
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-zinc-400")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 shrink-0 text-zinc-500 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
          onKeyDown={onListKey}
          className="absolute top-full right-0 left-0 z-50 mt-1.5 max-h-72 overflow-auto rounded-xl border border-zinc-200/80 bg-white p-1 shadow-lg shadow-zinc-950/5 focus:outline-none"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs font-semibold text-zinc-500">{emptyMessage}</li>
          ) : (
            options.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium",
                    index === active && "bg-zinc-100",
                    isSelected && "text-brand",
                    option.disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <Check
                    aria-hidden="true"
                    className={cn("size-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{option.label}</span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
