"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { label: "All", href: "/dashboard/leads" },
  { label: "To-dos", href: "/dashboard/leads/todos" },
  { label: "Shared phones", href: "/dashboard/leads/phone-overlap" },
  { label: "Pipeline", href: "/dashboard/leads/pipeline" },
  { label: "Regenerated", href: "/dashboard/leads/regenerated" },
  { label: "Favorites", href: "/dashboard/leads/favorites" },
  { label: "Reviews", href: "/dashboard/leads/reviews" },
  { label: "Won", href: "/dashboard/leads/won" },
  { label: "Lost", href: "/dashboard/leads/lost" },
  { label: "Duplicates", href: "/dashboard/leads/duplicates" },
];

/** Sub-view tab bar (reference: white 16px-radius bar, green selected chip). Lead detail/new map to "All". */
export function LeadsTabs() {
  const pathname = usePathname();
  const active =
    TABS.slice(1).find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href ?? "/dashboard/leads";

  return (
    <nav
      aria-label="Lead views"
      className="flex gap-1.5 overflow-x-auto rounded-2xl border border-zinc-200/80 bg-white p-1.5 shadow-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const selected = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center rounded-xl px-3.5 py-2 text-xs leading-4 font-bold whitespace-nowrap transition-colors",
              selected ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-zinc-100",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
