import Link from "next/link";
import { cn } from "@/lib/cn";
import { withParams } from "../url";

/** A sortable table header cell (FR-005). Sorting returns to page 1 and keeps the filters; the first click sorts highest first. */
export function SortTh<T extends string>({
  path,
  params,
  column,
  label,
  sort,
  dir,
  className,
}: {
  path: string;
  params: Record<string, string>;
  column: T;
  label: string;
  sort: T | undefined;
  dir: "asc" | "desc";
  className?: string;
}) {
  const current = sort === column;
  const nextDir = current && dir === "desc" ? "asc" : "desc";
  return (
    <th scope="col" className={className} aria-sort={current ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={withParams(path, params, { sort: column, dir: nextDir, page: null })} className="group inline-flex items-center gap-1.5 hover:text-zinc-900" aria-label={`Sort by ${label}`}>
        {label}
        <span aria-hidden="true" className="flex flex-col text-[7px] leading-[7px]">
          <span className={cn(current && dir === "asc" ? "text-brand" : "text-zinc-300")}>▲</span>
          <span className={cn(current && dir === "desc" ? "text-brand" : "text-zinc-300")}>▼</span>
        </span>
      </Link>
    </th>
  );
}
