"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { label: "All", href: "/dashboard/leads" },
  // Leads awaiting a first conversation; the tab bar follows the path only, so "All" stays selected there.
  { label: "New leads", href: "/dashboard/leads?view=new" },
  // Order by daily priority: today's work, then queues to clear, then outcomes, then data checks.
  { label: "To-dos", href: "/dashboard/leads/todos" },
  { label: "Stagnating", href: "/dashboard/leads/stagnating" },
  { label: "Meetings scheduled", href: "/dashboard/leads/meetings" },
  { label: "Booking in process", href: "/dashboard/leads/booking" },
  { label: "Pipeline", href: "/dashboard/leads/pipeline" },
  { label: "Favorites", href: "/dashboard/leads/favorites" },
  { label: "Verify", href: "/dashboard/leads/verify" },
  { label: "Unassigned", href: "/dashboard/leads/unassigned" },
  { label: "Repeat enquiries", href: "/dashboard/leads/regenerated" },
  // Leads saved as a duplicate of another (owner review, 16 Nov 2026; the page existed without a tab).
  { label: "Duplicates", href: "/dashboard/leads/duplicates" },
  { label: "Won", href: "/dashboard/leads/won" },
  { label: "Lost", href: "/dashboard/leads/lost" },
  { label: "Call reviews & notes", href: "/dashboard/leads/reviews" },
  { label: "Imports", href: "/dashboard/leads/import" },
];

/** Sub-view tab bar (reference: white 16px-radius bar, green selected chip). Lead detail/new map to "All". */
export function LeadsTabs({
  showImports = false,
  showUnassigned = true,
  verifyCount = null,
}: {
  showImports?: boolean;
  /** Agents claim from it; Admins and Super Admins assign from it (16 Nov 2026). */
  showUnassigned?: boolean;
  /** Admin and Super Admin only; null hides the Verify tab. */
  verifyCount?: number | null;
}) {
  const pathname = usePathname();
  const shown: Record<string, boolean> = {
    "/dashboard/leads/import": showImports,
    "/dashboard/leads/unassigned": showUnassigned,
    "/dashboard/leads/verify": verifyCount !== null,
  };
  const tabs = TABS.filter((t) => shown[t.href] ?? true);
  const active =
    TABS.slice(1).find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href ?? "/dashboard/leads";

  return (
    <nav
      aria-label="Lead views"
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
            {tab.href === "/dashboard/leads/verify" && verifyCount ? (
              <span className={cn("ml-1.5 rounded-full px-1.5 text-[10px] leading-4 font-black", selected ? "bg-white/25 text-white" : "bg-amber-100 text-amber-800")}>{verifyCount}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
