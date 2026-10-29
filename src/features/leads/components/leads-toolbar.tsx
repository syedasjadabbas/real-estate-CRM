"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { LeadLookups } from "@/modules/leads/queries";
import { formatInt } from "@/lib/format";
import { activeFilterCount, FILTER_KEYS, withParams } from "../url";
import { LeadFilterDrawer } from "./filter-drawer";

/** Search + Filters + Clear + count pill (reference toolbar card). */
export function LeadsToolbar({
  params,
  total,
  lookups,
  drawerTitle = "Lead filters",
}: {
  params: Record<string, string>;
  total: number;
  lookups: LeadLookups;
  drawerTitle?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(params.q ?? "");
  const filters = activeFilterCount(params);
  const hasAny = filters > 0 || Boolean(params.q);

  const go = (overrides: Record<string, string | null>) =>
    startTransition(() => router.replace(withParams(pathname, params, { ...overrides, page: null })));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    go({ q: q.trim() || null });
  };

  const clear = () => {
    setQ("");
    go(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
  };

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-hairline" aria-busy={pending}>
      <form onSubmit={onSubmit} role="search" className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Search leads</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Name, email, phone, lead code, or ID"
            className="h-10 w-full rounded-xl border border-zinc-200/80 bg-white pr-3.5 pl-10 text-sm leading-5 font-semibold text-zinc-900 shadow-hairline placeholder:font-medium placeholder:text-zinc-400 focus:border-brand/50 focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-[42px] items-center gap-2 rounded-2xl border border-zinc-200/80 bg-white px-3.5 text-xs leading-4 font-bold text-zinc-800 shadow-hairline hover:bg-zinc-50"
        >
          <SlidersHorizontal aria-hidden="true" className="size-3.5" />
          Filters
          {filters ? (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand text-[10px] font-black text-white">
              {filters}
            </span>
          ) : null}
        </button>
        {hasAny ? (
          <Button variant="secondary" size="lg" className="h-10 px-4 text-xs" onClick={clear}>
            Clear
          </Button>
        ) : null}
        <span className="inline-flex items-center rounded-full border border-brand/30 bg-brand-50 px-2.5 py-1 text-[10px] leading-[15px] font-black tracking-[0.05em] text-brand-700 uppercase">
          {formatInt(total)} {total === 1 ? "lead" : "leads"}
        </span>
      </form>
      <LeadFilterDrawer
        open={open}
        onClose={() => setOpen(false)}
        title={drawerTitle}
        params={params}
        lookups={lookups}
        onApply={go}
        total={total}
      />
    </div>
  );
}
