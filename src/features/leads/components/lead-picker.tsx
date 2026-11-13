"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { selectClass } from "./lead-fields";

/**
 * A lead dropdown with a small search box beside it (owner, 14 Nov 2026): typing narrows the list by
 * name or code. The chosen lead stays in the list even when the search no longer matches it.
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
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.value === value || o.label.toLowerCase().includes(q)) : options;
  const matches = q ? shown.filter((o) => o.value !== value || o.label.toLowerCase().includes(q)).length : options.length;

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative sm:w-44 sm:shrink-0">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            // One match: pick it, so typing a name or code is enough.
            const n = next.trim().toLowerCase();
            const hits = n ? options.filter((o) => o.label.toLowerCase().includes(n)) : [];
            if (hits.length === 1) onChange(hits[0].value);
          }}
          placeholder="Search leads"
          aria-label="Search leads by name or code"
          aria-controls={id}
          autoComplete="off"
          disabled={disabled}
          className="h-10 w-full rounded-xl border border-zinc-200/80 bg-white pr-2.5 pl-8 text-sm font-medium shadow-hairline focus:border-brand/50 focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60"
        />
      </div>
      <select id={id} aria-describedby={describedBy} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass} disabled={disabled}>
        <option value="">{q ? `${matches} ${matches === 1 ? "match" : "matches"}` : empty}</option>
        {shown.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
