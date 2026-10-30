"use client";

import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { selectClass } from "@/features/leads/components/lead-fields";
import { formatDateTime } from "@/features/leads/format";
import { withParams } from "@/features/leads/url";

const dateClass =
  "h-[38px] w-full rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-2.5 text-sm font-medium shadow-hairline focus:border-brand/50 focus:outline-none";

/**
 * Observed header controls: "Updated … · Refresh" and the "Performance filters" drawer
 * (CONTEXT + FROM / TO; "Changes apply immediately.", Clear filters, Done).
 */
export function PerformanceFilters({
  params,
  from,
  to,
  contexts,
  allLabel,
  generatedAt,
}: {
  params: Record<string, string>;
  from: string;
  to: string;
  /** Teams the actor may scope to; empty for agents ("Your metrics"). */
  contexts: { id: string; name: string; isActive: boolean }[];
  allLabel: string | null;
  generatedAt: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const go = (overrides: Record<string, string | null>) => startTransition(() => router.replace(withParams(pathname, params, { ...overrides, page: null })));
  const active = Boolean(params.from || params.to || params.team);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <p className="text-[11px] font-semibold text-zinc-500">
        Updated {formatDateTime(generatedAt)} ·
      </p>
      <Button variant="secondary" className="h-[33px] px-3 text-xs" title="Recompute with the latest data" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
        <RefreshCw aria-hidden="true" className="size-3.5" />
        Refresh
      </Button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-[33px] items-center gap-2 rounded-xl border border-zinc-200/80 bg-white px-3 text-xs font-bold text-zinc-800 shadow-hairline hover:bg-zinc-50"
      >
        <SlidersHorizontal aria-hidden="true" className="size-3.5" />
        Filters
        {active ? <span className="inline-flex size-2 rounded-full bg-brand" aria-label="Filters applied" /> : null}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        side="right"
        title="Performance filters"
        description="Scope, team, and date range. Changes apply immediately."
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => go({ from: null, to: null, team: null })} disabled={pending}>
              Clear filters
            </Button>
            <Button variant="primary" size="lg" onClick={() => setOpen(false)}>
              Done
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Context">
            {(id) =>
              allLabel === null ? (
                <select id={id} disabled className={selectClass}>
                  <option>Your metrics</option>
                </select>
              ) : (
                <select id={id} value={params.team ?? ""} onChange={(e) => go({ team: e.target.value || null })} className={selectClass} disabled={pending}>
                  <option value="">{allLabel}</option>
                  {contexts.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.isActive ? "" : " (inactive)"}
                    </option>
                  ))}
                </select>
              )
            }
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              {(id) => <input id={id} type="date" value={from} max={to} onChange={(e) => e.target.value && go({ from: e.target.value })} className={dateClass} disabled={pending} />}
            </Field>
            <Field label="To">
              {(id) => <input id={id} type="date" value={to} min={from} onChange={(e) => e.target.value && go({ to: e.target.value })} className={dateClass} disabled={pending} />}
            </Field>
          </div>
          <p className="text-[11px] text-zinc-500">Dates are inclusive, in Pakistan time. Ranges longer than a year are shortened to the last 366 days.</p>
        </div>
      </Modal>
    </div>
  );
}
