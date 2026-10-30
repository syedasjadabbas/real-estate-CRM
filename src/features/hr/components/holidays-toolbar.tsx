"use client";

import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { selectClass } from "@/features/leads/components/lead-fields";
import { withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { HOLIDAY_SCOPES, HOLIDAY_SCOPE_LABELS, MAX_YEAR, MIN_YEAR } from "@/modules/holidays/validation";

const FILTER_KEYS = ["scope", "region"] as const;

/** Year stepper, List / Calendar switch, search and the Filters drawer (Scope, Region), in the Meetings toolbar style. */
export function HolidaysToolbar({
  params,
  year,
  view,
  total,
  regions,
  action,
}: {
  params: Record<string, string>;
  year: number;
  view: "list" | "calendar";
  total: number;
  regions: string[];
  action?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(params.q ?? "");
  const filters = FILTER_KEYS.filter((k) => params[k]).length;
  const hasAny = filters > 0 || Boolean(params.q);
  const go = (overrides: Record<string, string | null>) => startTransition(() => router.replace(withParams(pathname, params, overrides)));
  const clearFilters = () => go(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    go({ q: q.trim() || null });
  };
  const stepYear = (delta: number) => go({ year: String(year + delta) });

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-hairline" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Year" className="inline-flex items-center rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-1 shadow-hairline">
          <button type="button" aria-label="Previous year" disabled={pending || year <= MIN_YEAR} onClick={() => stepYear(-1)} className="rounded-lg p-1.5 text-zinc-700 hover:bg-white disabled:opacity-40">
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <span className="min-w-12 px-1 text-center text-sm font-black tabular-nums" aria-live="polite">
            {year}
          </span>
          <button type="button" aria-label="Next year" disabled={pending || year >= MAX_YEAR} onClick={() => stepYear(1)} className="rounded-lg p-1.5 text-zinc-700 hover:bg-white disabled:opacity-40">
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div role="group" aria-label="View" className="inline-flex rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-1 shadow-hairline">
          {(["list", "calendar"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={v === view}
              disabled={pending}
              onClick={() => go({ view: v === "list" ? null : v })}
              className={cn("rounded-lg px-3 py-1.5 text-xs font-bold transition-colors", v === view ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-white")}
            >
              {v === "list" ? "List" : "Calendar"}
            </button>
          ))}
        </div>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      <form onSubmit={onSubmit} role="search" className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Search holidays</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Holiday name or region"
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
          {filters ? <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand text-[10px] font-black text-white">{filters}</span> : null}
        </button>
        {hasAny ? (
          <Button
            variant="secondary"
            size="lg"
            className="h-10 px-4 text-xs"
            onClick={() => {
              setQ("");
              go({ q: null, ...Object.fromEntries(FILTER_KEYS.map((k) => [k, null])) });
            }}
          >
            Clear
          </Button>
        ) : null}
        <span className="inline-flex items-center rounded-full border border-brand/30 bg-brand-50 px-2.5 py-1 text-[10px] leading-[15px] font-black tracking-[0.05em] text-brand-700 uppercase">
          {formatInt(total)} {total === 1 ? "holiday" : "holidays"}
        </span>
      </form>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        side="right"
        title="Holiday filters"
        description="Refine the calendar. Changes apply immediately."
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={clearFilters}>
              Clear filters
            </Button>
            <Button variant="primary" size="lg" onClick={() => setOpen(false)}>
              Done
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <span className="inline-flex rounded-full border border-brand/30 bg-brand-50 px-2.5 py-1 text-[10px] font-black tracking-[0.05em] text-brand-700 uppercase">
            {formatInt(total)} {total === 1 ? "holiday" : "holidays"} in {year}
          </span>
          <Field label="Scope">
            {(id) => (
              <select id={id} value={params.scope ?? ""} onChange={(e) => go({ scope: e.target.value || null })} className={selectClass} disabled={pending}>
                <option value="">All scopes</option>
                {HOLIDAY_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {HOLIDAY_SCOPE_LABELS[s]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Region" hint={regions.length ? undefined : "No regional holidays on file yet."}>
            {(id, d) => (
              <select id={id} aria-describedby={d} value={params.region ?? ""} onChange={(e) => go({ region: e.target.value || null })} className={selectClass} disabled={pending || regions.length === 0}>
                <option value="">All regions</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Modal>
    </div>
  );
}
