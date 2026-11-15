"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/features/leads/components/lead-fields";
import { withParams } from "@/features/leads/url";
import { formatInt } from "@/lib/format";
import { RELATIONSHIP_LABELS, RELATIONSHIPS } from "@/modules/clients/constants";

type Option = { id: string; name: string };

const FILTER_KEYS = ["project", "interest", "owner", "city", "relationship", "booking", "followUp", "from", "to"] as const;

const dateClass =
  "h-10 w-full rounded-xl border border-zinc-200/80 bg-white px-2.5 text-sm font-medium shadow-hairline focus:border-brand/50 focus:outline-none";

/**
 * Search plus filters (owner, 15 Nov 2026): interested in project, has investment in project,
 * agent, city, relationship, booking, follow-up and date added. "Has investment" needs Bookings
 * (`projects` is null without it); the agent filter is for roles that see other agents' clients.
 */
export function ClientsToolbar({
  params,
  total,
  projects,
  interestProjects,
  owners,
  cities,
}: {
  params: Record<string, string>;
  total: number;
  projects: Option[] | null;
  interestProjects: Option[];
  owners: Option[];
  cities: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q ?? "");

  const go = (overrides: Record<string, string | null>) =>
    startTransition(() => router.replace(withParams(pathname, params, { ...overrides, page: null })));
  const active = FILTER_KEYS.filter((k) => params[k]).length;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    go({ q: q.trim() || null });
  };

  const select = (key: string, label: string, options: { value: string; label: string }[]) => (
    <label className="min-w-0">
      <span className="mb-1 block text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{label}</span>
      <select className={selectClass} value={params[key] ?? ""} disabled={pending} onChange={(event) => go({ [key]: event.target.value || null })}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const asOptions = (list: Option[]) => list.map((o) => ({ value: o.id, label: o.name }));

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-hairline" aria-busy={pending}>
      <form onSubmit={onSubmit} role="search" className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Search clients</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Name, email, or phone"
            className="h-10 w-full rounded-xl border border-zinc-200/80 bg-white pr-3.5 pl-10 text-sm leading-5 font-semibold text-zinc-900 shadow-hairline placeholder:font-medium placeholder:text-zinc-400 focus:border-brand/50 focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
        </label>
        {params.q || active ? (
          <Button
            variant="secondary"
            size="lg"
            className="h-10 px-4 text-xs"
            onClick={() => {
              setQ("");
              go(Object.fromEntries(["q", ...FILTER_KEYS].map((k) => [k, null])));
            }}
          >
            Clear{active ? ` (${active})` : ""}
          </Button>
        ) : null}
        <span className="inline-flex items-center rounded-full border border-brand/30 bg-brand-50 px-2.5 py-1 text-[10px] leading-[15px] font-black tracking-[0.05em] text-brand-700 uppercase">
          {formatInt(total)} {total === 1 ? "client" : "clients"}
        </span>
      </form>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {select("interest", "Interested in project", asOptions(interestProjects))}
        {projects ? select("project", "Has investment in project", asOptions(projects)) : null}
        {owners.length ? select("owner", "Agent", asOptions(owners)) : null}
        {select("city", "City", asOptions(cities))}
        {select("relationship", "Relationship", RELATIONSHIPS.map((r) => ({ value: r, label: RELATIONSHIP_LABELS[r] })))}
        {select("booking", "Booking", [
          { value: "booked", label: "Has a booking" },
          { value: "none", label: "No booking yet" },
        ])}
        {select("followUp", "Follow-up", [
          { value: "overdue", label: "Overdue" },
          { value: "today", label: "Due today" },
          { value: "none", label: "None scheduled" },
        ])}
        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0">
            <span className="mb-1 block text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Added from</span>
            <input type="date" className={dateClass} value={params.from ?? ""} disabled={pending} onChange={(event) => go({ from: event.target.value || null })} />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">to</span>
            <input type="date" className={dateClass} value={params.to ?? ""} disabled={pending} onChange={(event) => go({ to: event.target.value || null })} />
          </label>
        </div>
      </div>
    </div>
  );
}
