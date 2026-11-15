"use client";

import { Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

export type FilterItem = { id: string; text: string; tag?: string; node: ReactNode };

/**
 * A list on the work profile with a search box, an optional type filter and "Show more"
 * (16 Nov 2026). The rows are already drawn on the server; this only hides and shows them.
 */
export function FilterList({ items, empty, tags, tagLabel = "All", step = 10, placeholder = "Search lead name or code" }: { items: FilterItem[]; empty: string; tags?: string[]; tagLabel?: string; step?: number; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [shown, setShown] = useState(step);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => (!tag || i.tag === tag) && (!s || i.text.toLowerCase().includes(s)));
  }, [items, q, tag]);

  if (items.length === 0) return <p className="text-xs text-zinc-500">{empty}</p>;
  return (
    <div>
      {items.length > 5 || tags?.length ? (
        <div className="mb-2 flex flex-wrap gap-2 print:hidden">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search</span>
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShown(step);
              }}
              placeholder={placeholder}
              className="h-8 w-full rounded-md border border-zinc-200 pr-2 pl-7 text-xs outline-none focus:border-brand"
            />
          </label>
          {tags?.length ? (
            <select
              aria-label="Filter by type"
              value={tag}
              onChange={(e) => {
                setTag(e.target.value);
                setShown(step);
              }}
              className="h-8 rounded-md border border-zinc-200 px-2 text-xs"
            >
              <option value="">{tagLabel}</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}
      {hits.length === 0 ? (
        <p className="text-xs text-zinc-500">Nothing matches.</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {hits.slice(0, shown).map((i) => (
            <li key={i.id}>{i.node}</li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500 print:hidden">
        <span>
          Showing {Math.min(shown, hits.length)} of {hits.length}
        </span>
        {hits.length > shown ? (
          <span className="flex gap-3">
            <button type="button" onClick={() => setShown(shown + step)} className="font-bold text-brand hover:underline">
              Show more
            </button>
            <button type="button" onClick={() => setShown(hits.length)} className="font-bold text-brand hover:underline">
              Show all
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
