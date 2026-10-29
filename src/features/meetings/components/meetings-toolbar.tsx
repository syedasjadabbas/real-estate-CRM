"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { selectClass } from "@/features/leads/components/lead-fields";
import { withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { MEETING_STATUSES, MEETING_STATUS_LABELS } from "@/modules/meetings/constants";
import { activeMeetingFilters, MEETING_FILTER_KEYS } from "../url";

/** FR-102: search + Filters drawer (Status, Organizer, Overdue) + Clear + count pill, in the Leads toolbar style. */
export function MeetingsToolbar({ params, total, organizers }: { params: Record<string, string>; total: number; organizers: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(params.q ?? "");
  const filters = activeMeetingFilters(params);
  const hasAny = filters > 0 || Boolean(params.q);

  const go = (overrides: Record<string, string | null>) =>
    startTransition(() => router.replace(withParams(pathname, params, { ...overrides, page: null })));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    go({ q: q.trim() || null });
  };
  const clearFilters = () => go(Object.fromEntries(MEETING_FILTER_KEYS.map((k) => [k, null])));

  const select = (key: "status" | "organizer", label: string, options: { value: string; label: string }[]) => (
    <Field label={label}>
      {(id) => (
        <select id={id} value={params[key] ?? ""} onChange={(e) => go({ [key]: e.target.value || null })} className={selectClass} disabled={pending}>
          <option value="">Any</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-hairline" aria-busy={pending}>
      <form onSubmit={onSubmit} role="search" className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Search meetings</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Title, lead name, or lead code"
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
              go({ q: null, ...Object.fromEntries(MEETING_FILTER_KEYS.map((k) => [k, null])) });
            }}
          >
            Clear
          </Button>
        ) : null}
        <span className="inline-flex items-center rounded-full border border-brand/30 bg-brand-50 px-2.5 py-1 text-[10px] leading-[15px] font-black tracking-[0.05em] text-brand-700 uppercase">
          {formatInt(total)} {total === 1 ? "meeting" : "meetings"}
        </span>
      </form>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        side="right"
        title="Meeting filters"
        description="Refine the list. Changes apply immediately."
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
            {formatInt(total)} meetings
          </span>
          {select("status", "Status", MEETING_STATUSES.map((s) => ({ value: s, label: MEETING_STATUS_LABELS[s] })))}
          {select("organizer", "Organizer", [{ value: "me", label: "Organized by me" }, ...organizers.map((o) => ({ value: o.id, label: o.name }))])}
          <button
            type="button"
            aria-pressed={params.overdue === "1"}
            onClick={() => go({ overdue: params.overdue === "1" ? null : "1" })}
            className={cn(
              "rounded-xl border px-2.5 py-1.5 text-xs font-bold transition-colors",
              params.overdue === "1" ? "border-brand bg-brand text-white shadow-hairline" : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50",
            )}
          >
            Overdue only
          </button>
        </div>
      </Modal>
    </div>
  );
}
