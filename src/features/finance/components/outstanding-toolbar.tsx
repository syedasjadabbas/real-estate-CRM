"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/features/leads/components/lead-fields";
import { withParams } from "@/features/leads/url";

/** Search + project + milestone filter for the Outstanding view. */
export function OutstandingToolbar({ params, projects }: { params: Record<string, string>; projects: { id: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q ?? "");
  const go = (overrides: Record<string, string | null>) => startTransition(() => router.replace(withParams(pathname, params, overrides)));
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
            placeholder="Lead, lead code, or unit"
            className="h-10 w-full rounded-xl border border-zinc-200/80 bg-white pr-3.5 pl-10 text-sm leading-5 font-semibold text-zinc-900 shadow-hairline placeholder:font-medium placeholder:text-zinc-400 focus:border-brand/50 focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
        </label>
        <label className="min-w-0 flex-1 basis-40 lg:flex-none">
          <span className="sr-only">Project</span>
          <select value={params.project ?? ""} onChange={(e) => go({ project: e.target.value || null })} className={selectClass} disabled={pending}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1 basis-40 lg:flex-none">
          <span className="sr-only">30% milestone</span>
          <select value={params.milestone ?? ""} onChange={(e) => go({ milestone: e.target.value || null })} className={selectClass} disabled={pending}>
            <option value="">Any milestone</option>
            <option value="not_met">30% not met</option>
            <option value="met">30% met</option>
          </select>
        </label>
        {params.q || params.project || params.milestone ? (
          <Button
            variant="secondary"
            size="lg"
            className="h-10 px-4 text-xs"
            onClick={() => {
              setQ("");
              go({ q: null, project: null, milestone: null });
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>
    </div>
  );
}
