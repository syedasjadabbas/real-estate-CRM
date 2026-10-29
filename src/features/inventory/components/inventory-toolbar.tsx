"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/features/leads/components/lead-fields";
import { withParams } from "@/features/leads/url";
import { formatInt } from "@/lib/format";
import { SALE_MODELS, SALE_MODEL_LABELS, UNIT_STATUSES, UNIT_STATUS_LABELS } from "@/modules/inventory/constants";

/** Reference inventory filters: search, Project, Status, Nature, Sale model (FR-073). */
export function InventoryToolbar({
  params,
  total,
  projects,
  projectId,
  natures,
}: {
  params: Record<string, string>;
  total: number;
  projects: { id: string; label: string }[];
  /** Project the list is showing (null = all projects). */
  projectId: string | null;
  natures: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q ?? "");
  const hasAny = Boolean(params.q || params.status || params.saleModel || params.nature);

  const go = (overrides: Record<string, string | null>) =>
    startTransition(() => router.replace(withParams(pathname, params, { ...overrides, page: null })));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    go({ q: q.trim() || null });
  };

  const filter = (label: string, value: string, onChange: (v: string) => void, options: { value: string; label: string }[], empty: string) => (
    <label className="min-w-0 flex-1 basis-40 lg:flex-none">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass} disabled={pending}>
        {empty ? <option value="">{empty}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-hairline" aria-busy={pending}>
      <form onSubmit={onSubmit} role="search" className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Search units</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Unit, floor, block, category, type, or comment"
            className="h-10 w-full rounded-xl border border-zinc-200/80 bg-white pr-3.5 pl-10 text-sm leading-5 font-semibold text-zinc-900 shadow-hairline placeholder:font-medium placeholder:text-zinc-400 focus:border-brand/50 focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
        </label>
        {filter("Project", projectId ?? "all", (v) => go({ project: v }), [{ value: "all", label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: p.label }))], "")}
        {filter("Status", params.status ?? "", (v) => go({ status: v || null }), UNIT_STATUSES.map((s) => ({ value: s, label: UNIT_STATUS_LABELS[s] })), "All statuses")}
        {filter("Nature", params.nature ?? "", (v) => go({ nature: v || null }), natures.map((n) => ({ value: n, label: n })), "All natures")}
        {filter("Sale model", params.saleModel ?? "", (v) => go({ saleModel: v || null }), SALE_MODELS.map((m) => ({ value: m, label: SALE_MODEL_LABELS[m] })), "All sale models")}
        {hasAny ? (
          <Button
            variant="secondary"
            size="lg"
            className="h-10 px-4 text-xs"
            onClick={() => {
              setQ("");
              go({ q: null, status: null, saleModel: null, nature: null });
            }}
          >
            Clear
          </Button>
        ) : null}
        <span className="inline-flex items-center rounded-full border border-brand/30 bg-brand-50 px-2.5 py-1 text-[10px] leading-[15px] font-black tracking-[0.05em] text-brand-700 uppercase">
          {formatInt(total)} {total === 1 ? "unit" : "units"}
        </span>
      </form>
    </div>
  );
}
