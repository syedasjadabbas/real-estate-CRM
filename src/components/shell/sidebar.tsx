"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { brand } from "@/config/brand";
import { navigation, type NavGroup } from "@/config/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { SessionUser } from "@/lib/session";

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

type NavGroupsProps = { groups: NavGroup[]; onNavigate?: () => void };

function NavGroups({ groups, pathname, onNavigate }: NavGroupsProps & { pathname: string | null }) {
  return groups.map((group) => (
    <div key={group.label} className="mb-3">
      <div className="px-3 py-1 leading-6">
        <span className="text-[11px] leading-[16.5px] font-black tracking-[0.1em] text-zinc-400 uppercase">{group.label}</span>
      </div>
      <ul className="mt-1 space-y-1">
        {group.items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm leading-5 font-bold transition-colors",
                  active
                    ? "bg-linear-to-r from-brand to-brand-700 text-white shadow-brand-hairline"
                    : "text-zinc-700 hover:bg-zinc-100/80 hover:text-zinc-950",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-5 shrink-0 transition-transform group-hover:scale-105",
                    active ? "text-white" : "text-zinc-400 group-hover:text-zinc-600",
                  )}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {active ? <span className="size-2 rounded-full bg-white shadow-hairline" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  ));
}

function ActiveNavGroups(props: NavGroupsProps) {
  return <NavGroups {...props} pathname={usePathname()} />;
}

export function Sidebar({
  user,
  onNavigate,
}: {
  user: SessionUser | null;
  /** Called after a link is chosen (closes the mobile drawer). */
  onNavigate?: () => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses the menu search, as in the reference.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return navigation;
    return navigation
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.label.toLowerCase().includes(q)),
      }))
      .filter((group) => group.items.length > 0);
  }, [query]);

  return (
    <div className="flex h-full flex-col">
      {/* Brand — text wordmark until an official logo is supplied */}
      <div className="flex h-20 shrink-0 items-center gap-3.5 border-b border-zinc-100 bg-white/50 px-6">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50/80 text-[13px] font-black tracking-[-0.02em] text-brand shadow-hairline ring-2 ring-brand/20">
          {brand.monogram}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg leading-[18px] font-black tracking-[-0.025em] uppercase">
            {brand.name}
          </p>
          <p className="mt-1 truncate text-xs leading-4 font-semibold text-zinc-400">{brand.tagline}</p>
        </div>
      </div>

      {/* Menu search */}
      <div className="shrink-0 px-4 py-3">
        <label className="flex items-center rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-2 text-sm text-zinc-700 shadow-hairline focus-within:border-brand/40 focus-within:bg-white">
          <Search aria-hidden="true" className="mr-2 size-4 shrink-0 text-zinc-400" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search menu"
            className="min-w-0 flex-1 bg-transparent text-sm leading-5 font-medium text-zinc-900 placeholder:text-zinc-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          <Kbd>/</Kbd>
        </label>
      </div>

      {/* Navigation */}
      <nav
        aria-label="Main"
        className="flex-1 overflow-y-auto px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {/* The current URL is request data: stream the active highlight, prerender the plain menu. */}
        <Suspense fallback={<NavGroups groups={groups} pathname={null} onNavigate={onNavigate} />}>
          <ActiveNavGroups groups={groups} onNavigate={onNavigate} />
        </Suspense>
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs font-semibold text-zinc-400">No menu items match.</p>
        ) : null}
      </nav>

      {/* User card */}
      <div className="shrink-0 border-t border-zinc-100 bg-white/50 p-3.5">
        <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-3 shadow-hairline">
          <div className="flex items-center gap-3">
            <Avatar name={user?.name} presence={Boolean(user)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm leading-[17.5px] font-bold">
                {user?.name ?? "Loading…"}
              </p>
              <p className="truncate text-xs leading-[15px] font-medium text-zinc-600">
                {user?.email ?? " "}
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between border-t border-zinc-200/60 pt-2 text-xs leading-4 font-bold">
            <span className="text-zinc-400">Workspace</span>
            <span className="truncate text-zinc-800">{brand.name}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
