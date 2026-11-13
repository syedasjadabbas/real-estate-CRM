"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { selectClass } from "@/features/leads/components/lead-fields";
import { withParams } from "@/features/leads/url";
import { formatInt } from "@/lib/format";
import { ROLES } from "@/modules/employees/validation";
import { ROLE_LABELS } from "@/server/auth/types";

const FILTER_KEYS = ["role", "status", "department"] as const;

/** Search + Filters drawer (Role, Status, Department) + Clear + count pill, in the Meetings toolbar style. */
export function EmployeesToolbar({ params, total, departments }: { params: Record<string, string>; total: number; departments: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(params.q ?? "");
  const filters = FILTER_KEYS.filter((k) => params[k]).length;
  const hasAny = filters > 0 || Boolean(params.q);
  const go = (overrides: Record<string, string | null>) => startTransition(() => router.replace(withParams(pathname, params, { ...overrides, page: null })));
  const clearFilters = () => go(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    go({ q: q.trim() || null });
  };
  const select = (key: (typeof FILTER_KEYS)[number], label: string, empty: string, options: { value: string; label: string }[]) => (
    <Field label={label}>
      {(id) => (
        <select id={id} value={params[key] ?? ""} onChange={(e) => go({ [key]: e.target.value || null })} className={selectClass} disabled={pending}>
          <option value="">{empty}</option>
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
          <span className="sr-only">Search employees</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Name, email, designation or department"
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
          {formatInt(total)} {total === 1 ? "employee" : "employees"}
        </span>
      </form>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        side="right"
        title="Employee filters"
        description="Refine the directory. Changes apply immediately."
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
            {formatInt(total)} {total === 1 ? "employee" : "employees"}
          </span>
          {select("role", "Role", "All roles", [...ROLES.filter((r) => r !== "manager").map((r) => ({ value: r, label: ROLE_LABELS[r] })), { value: "none", label: "No CRM login" }])}
          {select("status", "Account status", "All statuses", [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ])}
          {select("department", "Department", departments.length ? "All departments" : "No departments on file yet", departments.map((d) => ({ value: d, label: d })))}
        </div>
      </Modal>
    </div>
  );
}
