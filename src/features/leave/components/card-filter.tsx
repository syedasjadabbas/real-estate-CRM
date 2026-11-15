import Link from "next/link";
import { withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";

type Select = { name: string; label: string; all: string; options: { value: string; label: string }[] };
const field = "mt-1 block h-9 rounded-xl border border-zinc-200/80 bg-white px-2 text-xs font-semibold";
const labelClass = "text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase";

/**
 * A small filter row for one card on HR → Leave (15 Nov 2026). A plain GET form that keeps every other
 * parameter on the page, so filtering this card leaves the other cards as they are.
 */
export function CardFilter({
  path,
  params,
  label,
  search,
  selects = [],
}: {
  path: string;
  params: Record<string, string>;
  label: string;
  search: { name: string; placeholder: string };
  selects?: Select[];
}) {
  const own = [search.name, ...selects.map((s) => s.name)];
  const active = own.some((k) => params[k]);
  return (
    <form method="get" action={path} className="mb-3 flex flex-wrap items-end gap-2" aria-label={label}>
      {Object.entries(params)
        .filter(([k]) => !own.includes(k) && k !== "page")
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <label className={labelClass}>
        Search
        <input type="search" name={search.name} defaultValue={params[search.name] ?? ""} placeholder={search.placeholder} maxLength={100} className={cn(field, "w-52 max-w-full")} />
      </label>
      {selects.map((s) => (
        <label key={s.name} className={labelClass}>
          {s.label}
          <select name={s.name} defaultValue={params[s.name] ?? ""} className={field}>
            <option value="">{s.all}</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button type="submit" className="h-9 rounded-xl bg-brand px-3.5 text-xs font-bold text-white">
        Apply
      </button>
      {active ? (
        <Link href={withParams(path, params, Object.fromEntries(own.map((k) => [k, null])))} className="h-9 rounded-xl border border-zinc-200/80 px-3.5 text-xs leading-9 font-bold text-zinc-700 hover:bg-zinc-50">
          Clear
        </Link>
      ) : null}
    </form>
  );
}
