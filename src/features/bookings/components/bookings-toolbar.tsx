"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/features/leads/components/lead-fields";
import { withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { BOOKING_STAGE_LABELS, CURRENT_STAGES } from "@/modules/bookings/constants";

/** Bookings filters: search, Project, Stage (FR-085); Agent, Team and booked dates (16 Nov 2026). */
export function BookingsToolbar({
  params,
  total,
  projects,
  projectId,
  agents = [],
  teams = [],
}: {
  params: Record<string, string>;
  total: number;
  projects: { id: string; label: string }[];
  projectId: string | null;
  agents?: { id: string; name: string }[];
  teams?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q ?? "");
  const hasAny = Boolean(params.q || params.stage || params.agent || params.team || params.from || params.to);

  const go = (overrides: Record<string, string | null>) =>
    startTransition(() => router.replace(withParams(pathname, params, { ...overrides, page: null })));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    go({ q: q.trim() || null });
  };

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-hairline" aria-busy={pending}>
      <form onSubmit={onSubmit} role="search" className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Search bookings</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Lead name, phone, lead code, or unit"
            className="h-10 w-full rounded-xl border border-zinc-200/80 bg-white pr-3.5 pl-10 text-sm leading-5 font-semibold text-zinc-900 shadow-hairline placeholder:font-medium placeholder:text-zinc-400 focus:border-brand/50 focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
        </label>
        <label className="min-w-0 flex-1 basis-40 lg:flex-none">
          <span className="sr-only">Project</span>
          <select value={projectId ?? "all"} onChange={(e) => go({ project: e.target.value })} className={selectClass} disabled={pending}>
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1 basis-40 lg:flex-none">
          <span className="sr-only">Stage</span>
          <select value={params.stage ?? ""} onChange={(e) => go({ stage: e.target.value || null })} className={selectClass} disabled={pending}>
            <option value="">All stages</option>
            {CURRENT_STAGES.map((s) => (
              <option key={s} value={s}>
                {BOOKING_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {agents.length > 1 ? (
          <label className="min-w-0 flex-1 basis-40 lg:flex-none">
            <span className="sr-only">Sales agent</span>
            <select value={params.agent ?? ""} onChange={(e) => go({ agent: e.target.value || null })} className={selectClass} disabled={pending}>
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {teams.length ? (
          <label className="min-w-0 flex-1 basis-40 lg:flex-none">
            <span className="sr-only">Team</span>
            <select value={params.team ?? ""} onChange={(e) => go({ team: e.target.value || null })} className={selectClass} disabled={pending}>
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="flex w-full min-w-0 items-center gap-1.5 text-xs font-bold text-zinc-500 sm:w-auto sm:flex-1 sm:basis-72 lg:flex-none">
          Booked
          <input type="date" aria-label="Booked from" value={params.from ?? ""} max={params.to} onChange={(e) => go({ from: e.target.value || null })} className={cn(selectClass, "min-w-0 flex-1 lg:w-36 lg:flex-none")} disabled={pending} />
          to
          <input type="date" aria-label="Booked to" value={params.to ?? ""} min={params.from} onChange={(e) => go({ to: e.target.value || null })} className={cn(selectClass, "min-w-0 flex-1 lg:w-36 lg:flex-none")} disabled={pending} />
        </span>
        {hasAny ? (
          <Button
            variant="secondary"
            size="lg"
            className="h-10 px-4 text-xs"
            onClick={() => {
              setQ("");
              go({ q: null, stage: null, agent: null, team: null, from: null, to: null });
            }}
          >
            Clear
          </Button>
        ) : null}
        <span className="inline-flex items-center rounded-full border border-brand/30 bg-brand-50 px-2.5 py-1 text-[10px] leading-[15px] font-black tracking-[0.05em] text-brand-700 uppercase">
          {formatInt(total)} {total === 1 ? "booking" : "bookings"}
        </span>
      </form>
    </div>
  );
}
