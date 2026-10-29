"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectClass } from "@/features/leads/components/lead-fields";
import { withParams } from "@/features/leads/url";
import { formatInt } from "@/lib/format";
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS } from "@/modules/finance/constants";

/** Search + project + type + entry kind + date range, in the shared toolbar card. */
export function PaymentsToolbar({ params, total, projects }: { params: Record<string, string>; total: number; projects: { id: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q ?? "");
  const hasAny = ["q", "project", "type", "kind", "from", "to"].some((k) => params[k]);

  const go = (overrides: Record<string, string | null>) =>
    startTransition(() => router.replace(withParams(pathname, params, { ...overrides, page: null })));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    go({ q: q.trim() || null });
  };
  const select = (label: string, key: string, options: { value: string; label: string }[], empty: string) => (
    <label className="min-w-0 flex-1 basis-36 lg:flex-none">
      <span className="sr-only">{label}</span>
      <select value={params[key] ?? ""} onChange={(e) => go({ [key]: e.target.value || null })} className={selectClass} disabled={pending}>
        <option value="">{empty}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const date = (label: string, key: "from" | "to") => (
    <label className="min-w-0 flex-1 basis-36 lg:flex-none">
      <span className="sr-only">{label}</span>
      <Input type="date" aria-label={label} value={params[key] ?? ""} onChange={(e) => go({ [key]: e.target.value || null })} disabled={pending} />
    </label>
  );

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-hairline" aria-busy={pending}>
      <form onSubmit={onSubmit} role="search" className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Search payments</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Lead, lead code, unit, reference, or receipt no."
            className="h-10 w-full rounded-xl border border-zinc-200/80 bg-white pr-3.5 pl-10 text-sm leading-5 font-semibold text-zinc-900 shadow-hairline placeholder:font-medium placeholder:text-zinc-400 focus:border-brand/50 focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
        </label>
        {select("Project", "project", projects.map((p) => ({ value: p.id, label: p.label })), "All projects")}
        {select("Type", "type", PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABELS[t] })), "All types")}
        {select("Entry", "kind", [{ value: "payment", label: "Payments" }, { value: "reversal", label: "Reversals" }], "Payments and reversals")}
        {date("Received from", "from")}
        {date("Received to", "to")}
        {hasAny ? (
          <Button
            variant="secondary"
            size="lg"
            className="h-10 px-4 text-xs"
            onClick={() => {
              setQ("");
              go({ q: null, project: null, type: null, kind: null, from: null, to: null });
            }}
          >
            Clear
          </Button>
        ) : null}
        <span className="inline-flex items-center rounded-full border border-brand/30 bg-brand-50 px-2.5 py-1 text-[10px] leading-[15px] font-black tracking-[0.05em] text-brand-700 uppercase">
          {formatInt(total)} {total === 1 ? "entry" : "entries"}
        </span>
      </form>
    </div>
  );
}
