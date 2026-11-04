import Link from "next/link";
import { cn } from "@/lib/cn";
import { withParams } from "../url";

export type SortLinkColumn<T extends string> = { key: T; label: string; /** First click sorts this way (counts read best highest first). */ firstDir?: "asc" | "desc" };

/** Column sorting for lists shown as cards, which have no table headers. Sorting returns to page 1 and keeps the filters. */
export function SortLinks<T extends string>({
  path,
  params,
  name,
  columns,
  sort,
  dir,
}: {
  path: string;
  params: Record<string, string>;
  name: string;
  columns: SortLinkColumn<T>[];
  sort: T | undefined;
  dir: "asc" | "desc";
}) {
  return (
    <nav aria-label={name} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
      <span className="text-zinc-400">Sort</span>
      {columns.map((c) => {
        const current = sort === c.key;
        const nextDir = current ? (dir === "asc" ? "desc" : "asc") : (c.firstDir ?? "asc");
        return (
          <Link
            key={c.key}
            href={withParams(path, params, { sort: c.key, dir: nextDir, page: null })}
            aria-current={current ? "true" : undefined}
            aria-label={current ? `Sort by ${c.label}, now ${dir === "asc" ? "ascending" : "descending"}` : `Sort by ${c.label}`}
            className={cn("inline-flex items-center gap-1.5 hover:text-zinc-900", current && "text-zinc-900")}
          >
            {c.label}
            <span aria-hidden="true" className="flex flex-col text-[7px] leading-[7px]">
              <span className={cn(current && dir === "asc" ? "text-brand" : "text-zinc-300")}>▲</span>
              <span className={cn(current && dir === "desc" ? "text-brand" : "text-zinc-300")}>▼</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
