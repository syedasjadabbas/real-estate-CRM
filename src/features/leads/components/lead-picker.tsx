"use client";

import { Search } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { selectClass } from "./lead-fields";

const MAX_SHOWN = 50;

/**
 * A lead dropdown with a search box beside it (owner, 14 Nov 2026). Typing opens a list of the
 * matching leads (name or code) under the box; click one, or use ↑ ↓ and Enter, to pick it. Escape
 * closes the list. The dropdown keeps showing the chosen lead and still lists every lead.
 */
export function LeadPicker({
  id,
  describedBy,
  value,
  onChange,
  options,
  empty,
  disabled,
}: {
  id: string;
  describedBy?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** The first, empty option ("Select a lead…" or "No lead"). */
  empty: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const q = query.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : [];
  const shown = matches.slice(0, MAX_SHOWN);
  const showList = open && q.length > 0;

  const pick = (v: string) => {
    onChange(v);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative sm:w-56 sm:shrink-0">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && shown[active] ? `${listId}-${active}` : undefined}
          aria-label="Search leads by name or code"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Let a click on a result land before the list closes.
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(e) => {
            if (!showList) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (shown[active]) pick(shown[active].value);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Search leads"
          autoComplete="off"
          disabled={disabled}
          className="h-10 w-full rounded-xl border border-zinc-200/80 bg-white pr-2.5 pl-8 text-sm font-medium shadow-hairline focus:border-brand/50 focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60"
        />
        {showList ? (
          <ul
            id={listId}
            role="listbox"
            aria-label="Matching leads"
            className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 min-w-[260px] overflow-auto rounded-xl border border-zinc-200/80 bg-white py-1 shadow-lg"
          >
            {shown.length === 0 ? (
              <li className="px-3 py-2 text-xs text-zinc-500">No leads match &ldquo;{query.trim()}&rdquo;.</li>
            ) : (
              shown.map((o, i) => (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={o.value === value}
                  onMouseDown={(e) => {
                    // Keep focus in the box so the list doesn't close before the pick.
                    e.preventDefault();
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                    pick(o.value);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "cursor-pointer px-3 py-2 text-sm",
                    i === active ? "bg-brand-50 text-zinc-900" : "text-zinc-700",
                    o.value === value && "font-bold",
                  )}
                >
                  {o.label}
                </li>
              ))
            )}
            {matches.length > MAX_SHOWN ? (
              <li className="px-3 py-1.5 text-[11px] text-zinc-500">Showing {MAX_SHOWN} of {matches.length}. Type more to narrow it down.</li>
            ) : null}
          </ul>
        ) : null}
      </div>
      <select id={id} aria-describedby={describedBy} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass} disabled={disabled}>
        <option value="">{empty}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
