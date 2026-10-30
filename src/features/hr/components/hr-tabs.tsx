import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * HR section tabs (reference: Overview / Leave for agents). Only built sections are listed;
 * Leave is added in its own milestone.
 */
export function HrTabs({ active, showEmployees, showHolidays }: { active: "overview" | "employees" | "holidays"; showEmployees: boolean; showHolidays: boolean }) {
  const tabs = [
    { key: "overview", label: "Overview", href: "/dashboard/hr" },
    ...(showEmployees ? [{ key: "employees", label: "Employees", href: "/dashboard/hr/employees" }] : []),
    ...(showHolidays ? [{ key: "holidays", label: "Holidays", href: "/dashboard/hr/holidays" }] : []),
  ];
  return (
    <nav
      aria-label="HR sections"
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
