"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { withParams } from "../url";

/** "Page X of Y · N total" + page input/Go + Previous/Next (reference). */
export function Pagination({
  page,
  pageCount,
  total,
  params,
}: {
  page: number;
  pageCount: number;
  total: number;
  params: Record<string, string>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [value, setValue] = useState(String(page));
  const href = (p: number) => withParams(pathname, params, { page: p > 1 ? String(p) : null });
  const nav = "h-[33px] px-4 text-xs";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-zinc-600">
        Page {page} of {pageCount} · {formatInt(total)} total
      </p>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const p = Math.min(pageCount, Math.max(1, Number(value) || 1));
          router.push(href(p));
        }}
      >
        <label className="sr-only" htmlFor="page-number">
          Page number, 1 to {pageCount}
        </label>
        <input
          id="page-number"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
          className="h-[33px] w-14 rounded-xl border border-zinc-200/80 bg-white px-2 text-center text-xs font-bold shadow-hairline focus:border-brand/50 focus:outline-none"
        />
        <button type="submit" className={buttonClasses({ variant: "secondary", className: "h-[33px] px-3 text-xs" })}>
          Go
        </button>
        <Link
          aria-disabled={page <= 1}
          href={href(Math.max(1, page - 1))}
          className={cn(buttonClasses({ variant: "secondary", className: nav }), page <= 1 && "pointer-events-none opacity-50")}
        >
          Previous
        </Link>
        <Link
          aria-disabled={page >= pageCount}
          href={href(Math.min(pageCount, page + 1))}
          className={cn(buttonClasses({ variant: "secondary", className: nav }), page >= pageCount && "pointer-events-none opacity-50")}
        >
          Next
        </Link>
      </form>
    </div>
  );
}
