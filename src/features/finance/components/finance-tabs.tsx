"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export type FinanceTab = { href: string; label: string };

/** Sub-view tab bar in the Leads style; the layout passes only the tabs the user's role may open. */
export function FinanceTabs({ tabs }: { tabs: FinanceTab[] }) {
  const pathname = usePathname();
  const active =
    tabs
      .filter((t) => t.href !== "/dashboard/finance")
      .find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href ?? "/dashboard/finance";

  return (
    <nav
      aria-label="Finance views"
      className="flex gap-1.5 overflow-x-auto rounded-2xl border border-zinc-200/80 bg-white p-1.5 shadow-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
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
