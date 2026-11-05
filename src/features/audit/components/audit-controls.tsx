import Link from "next/link";
import { withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import type { AuditSortColumn } from "@/modules/audit/service";

const field = "mt-1 block h-9 rounded-xl border border-zinc-200/80 bg-white px-2 text-xs font-semibold";
const labelClass = "text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase";
const FILTERS = ["q", "actor", "entity", "action", "from", "to"] as const;

/** Settings section tabs for Super Admins and Admins: Security settings, Cities and the Audit log. */
export function SettingsTabs({ active }: { active: "security" | "cities" | "audit" }) {
  const tabs = [
    { key: "security", label: "Security", href: "/dashboard/settings/security" },
    { key: "cities", label: "Cities", href: "/dashboard/settings/cities" },
    { key: "audit", label: "Audit log", href: "/dashboard/settings/audit-log" },
  ];
  return (
    <nav
      aria-label="Settings sections"
      className="flex gap-1.5 overflow-x-auto rounded-2xl border border-zinc-200/80 bg-white p-1.5 shadow-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "flex shrink-0 items-center rounded-xl px-3.5 py-2 text-xs leading-4 font-bold whitespace-nowrap transition-colors",
            t.key === active ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-zinc-100",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Search, user, record type, action and Pakistan-date range (a plain GET form: works before hydration).
 * Each control has its own aria-label, so its name isn't its label plus every option text.
 */
export function AuditFilters({
  path,
  params,
  options,
}: {
  path: string;
  params: Record<string, string>;
  options: { entities: string[]; actions: string[]; actors: { id: string; name: string }[] };
}) {
  const active = FILTERS.some((k) => params[k]);
  return (
    <form method="get" action={path} className="flex flex-wrap items-end gap-2" aria-label="Filter audit log">
      <label className={labelClass}>
        Search
        <input type="search" name="q" aria-label="Search" defaultValue={params.q ?? ""} placeholder="Action, record, user, value or IP" maxLength={100} className={cn(field, "w-60 max-w-full")} />
      </label>
      <label className={labelClass}>
        User
        <select name="actor" aria-label="User" defaultValue={params.actor ?? ""} className={cn(field, "max-w-48")}>
          <option value="">All users</option>
          {options.actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Record type
        <select name="entity" aria-label="Record type" defaultValue={params.entity ?? ""} className={field}>
          <option value="">All types</option>
          {options.entities.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Action
        <select name="action" aria-label="Action" defaultValue={params.action ?? ""} className={cn(field, "max-w-56")}>
          <option value="">All actions</option>
          {options.actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        From
        <input type="date" name="from" aria-label="From" defaultValue={params.from ?? ""} className={field} />
      </label>
      <label className={labelClass}>
        To
        <input type="date" name="to" aria-label="To" defaultValue={params.to ?? ""} className={field} />
      </label>
      {params.sort ? <input type="hidden" name="sort" value={params.sort} /> : null}
      {params.dir ? <input type="hidden" name="dir" value={params.dir} /> : null}
      <button type="submit" className="h-9 rounded-xl bg-brand px-3.5 text-xs font-bold text-white">
        Apply
      </button>
      {active ? (
        <Link
          href={withParams(path, params, { q: null, actor: null, entity: null, action: null, from: null, to: null, page: null })}
          className="h-9 rounded-xl border border-zinc-200/80 px-3.5 text-xs leading-9 font-bold text-zinc-700 hover:bg-zinc-50"
        >
          Clear all
        </Link>
      ) : null}
    </form>
  );
}

/** A sortable column header (newest first by default). */
export function AuditSortHeader({ path, params, column, label, sort, dir }: { path: string; params: Record<string, string>; column: AuditSortColumn; label: string; sort: AuditSortColumn; dir: "asc" | "desc" }) {
  const current = sort === column;
  const nextDir = current && dir === "desc" ? "asc" : "desc";
  return (
    <Link href={withParams(path, params, { sort: column, dir: nextDir, page: null })} className="group inline-flex items-center gap-1.5 hover:text-zinc-900" aria-label={`Sort by ${label}`}>
      {label}
      <span aria-hidden="true" className="flex flex-col text-[7px] leading-[7px]">
        <span className={cn(current && dir === "asc" ? "text-brand" : "text-zinc-300")}>▲</span>
        <span className={cn(current && dir === "desc" ? "text-brand" : "text-zinc-300")}>▼</span>
      </span>
    </Link>
  );
}
