"use client";

import { ChevronsLeft, ChevronsRight, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { brand } from "@/config/brand";
import { navigation, type NavGroup } from "@/config/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { SessionUser } from "@/lib/session";

/** An item whose link carries a query (New leads = Leads filtered to the New Lead stage) matches on it. */
function matchesQuery(href: string, search: URLSearchParams | null) {
  const query = href.split("?")[1];
  if (!query) return false;
  return [...new URLSearchParams(query)].every(([key, value]) => search?.get(key) === value);
}

/**
 * The item for the current page. A link with a query (New leads) is active only when the URL has that
 * query, and then the plain item for the same page (Leads) is not. A deeper menu item (To-dos inside
 * Leads) wins over its parent the same way, so exactly one item lights up.
 */
export function isActive(pathname: string | null, search: URLSearchParams | null, href: string, siblings: string[]) {
  if (!pathname) return false;
  const [path, query] = href.split("?");
  if (query) return pathname === path && matchesQuery(href, search);
  if (path === "/dashboard") return pathname === "/dashboard";
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  if (!under(path)) return false;
  return !siblings.some((other) => {
    if (other === href) return false;
    const [otherPath, otherQuery] = other.split("?");
    if (otherQuery) return otherPath === path && pathname === path && matchesQuery(other, search);
    return otherPath.startsWith(`${path}/`) && under(otherPath);
  });
}

type NavGroupsProps = { groups: NavGroup[]; onNavigate?: () => void; collapsed?: boolean };

function NavGroups({ groups, pathname, search, onNavigate, collapsed = false }: NavGroupsProps & { pathname: string | null; search: URLSearchParams | null }) {
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  return groups.map((group) => (
    <div key={group.label} className="mb-3">
      {collapsed ? (
        // Icon rail: a thin line stands in for the group name.
        <div aria-hidden="true" className="mx-auto my-2 h-px w-6 bg-white/10" />
      ) : (
        <div className="px-3 py-1 leading-6">
          <span className="text-[11px] leading-[16.5px] font-black tracking-[0.1em] text-zinc-500 uppercase">{group.label}</span>
        </div>
      )}
      <ul className="mt-1 space-y-1">
        {group.items.map((item) => {
          const active = isActive(pathname, search, item.href, hrefs);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? item.label : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-xl py-2.5 text-sm leading-5 font-bold transition-colors",
                  collapsed ? "justify-center px-0" : "px-3.5",
                  active
                    ? "bg-[#3d2e06] text-[#f5d27a] ring-1 ring-[#bb8c08]/40"
                    : "text-zinc-300 hover:bg-white/[0.06] hover:text-white",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-5 shrink-0 transition-transform group-hover:scale-105",
                    active ? "text-[#f5d27a]" : "text-zinc-500 group-hover:text-zinc-300",
                  )}
                />
                {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
                {active && !collapsed ? <span className="size-2 rounded-full bg-[#f5d27a]" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  ));
}

function ActiveNavGroups(props: NavGroupsProps) {
  return <NavGroups {...props} pathname={usePathname()} search={useSearchParams()} />;
}

export function Sidebar({
  user,
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
}: {
  user: SessionUser | null;
  /** Called after a link is chosen (closes the mobile drawer). */
  onNavigate?: () => void;
  /** Desktop icon rail (owner, 16 Nov 2026): icons only, names on hover. */
  collapsed?: boolean;
  /** Shown on desktop: expands or collapses the menu. */
  onToggleCollapsed?: () => void;
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
        if (collapsed && onToggleCollapsed) {
          onToggleCollapsed();
          setTimeout(() => searchRef.current?.focus(), 320);
        } else searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [collapsed, onToggleCollapsed]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Items with a role list are shown only to those roles (the lists mirror the pages' own checks).
    const visible = navigation
      .map((group) => ({
        ...group,
        items: group.items
          .filter((item) => !item.roles || (user ? item.roles.includes(user.role) : false))
          // "My team" is for Team Leads only (15 Nov 2026).
          .filter((item) => !item.teamLeadOnly || Boolean(user?.isTeamLead))
          .map((item) => (user && item.labels?.[user.role] ? { ...item, label: item.labels[user.role] } : item)),
      }))
      .filter((group) => group.items.length > 0);
    if (!q) return visible;
    return visible
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.label.toLowerCase().includes(q)),
      }))
      .filter((group) => group.items.length > 0);
  }, [query, user]);

  const toggleButton = onToggleCollapsed ? (
    <button
      type="button"
      onClick={onToggleCollapsed}
      aria-label={collapsed ? "Expand menu" : "Collapse menu"}
      aria-expanded={!collapsed}
      aria-controls="app-sidebar"
      title={collapsed ? "Expand menu" : "Collapse menu"}
      className={cn(
        "flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] py-2 text-xs font-bold text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white",
        collapsed ? "mx-auto size-10" : "w-full",
      )}
    >
      {collapsed ? <ChevronsRight aria-hidden="true" className="size-4" /> : <ChevronsLeft aria-hidden="true" className="size-4" />}
      {collapsed ? null : "Collapse menu"}
    </button>
  ) : null;

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-stretch">
        <div className="flex h-20 shrink-0 items-center justify-center border-b border-white/10 px-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logo, no resizing needed */}
          <img src={brand.logo.src} width={brand.logo.width} height={brand.logo.height} alt={brand.logo.alt} className="h-8 w-auto max-w-[52px] object-contain" />
        </div>
        <div className="shrink-0 px-3 py-3">
          {/* Searching the menu needs room: this opens the full menu with the search box ready. */}
          <button
            type="button"
            onClick={() => {
              onToggleCollapsed?.();
              setTimeout(() => searchRef.current?.focus(), 320);
            }}
            aria-label="Search menu"
            title="Search menu (/)"
            className="mx-auto flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <Search aria-hidden="true" className="size-4" />
          </button>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Suspense fallback={<NavGroups groups={groups} pathname={null} search={null} onNavigate={onNavigate} collapsed />}>
            <ActiveNavGroups groups={groups} onNavigate={onNavigate} collapsed />
          </Suspense>
        </nav>
        <div className="flex shrink-0 flex-col items-center gap-3 border-t border-white/10 p-3">
          {toggleButton}
          <span title={user?.name ?? undefined}>
            <Avatar name={user?.name} presence={Boolean(user)} />
          </span>
        </div>
        {/* Keeps "/" working while collapsed: it expands the menu and focuses the search. */}
        <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-hidden="true" tabIndex={-1} className="sr-only" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Brand: the MZ Marketing logo (16 Nov 2026) */}
      <div className="flex h-20 shrink-0 flex-col justify-center border-b border-white/10 px-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static logo, no resizing needed */}
        <img src={brand.logo.src} width={brand.logo.width} height={brand.logo.height} alt={brand.logo.alt} className="h-9 w-auto max-w-full object-contain object-left" />
        <p className="mt-1 truncate text-[10px] leading-3 font-bold tracking-[0.15em] text-zinc-500 uppercase">{brand.tagline}</p>
      </div>

      {/* Menu search */}
      <div className="shrink-0 px-4 py-3">
        <label className="flex items-center rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-zinc-300 focus-within:border-[#bb8c08]/60 focus-within:bg-white/10">
          <Search aria-hidden="true" className="mr-2 size-4 shrink-0 text-zinc-500" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search menu"
            className="min-w-0 flex-1 bg-transparent text-sm leading-5 font-medium text-zinc-100 placeholder:text-zinc-500 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
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
        <Suspense fallback={<NavGroups groups={groups} pathname={null} search={null} onNavigate={onNavigate} />}>
          <ActiveNavGroups groups={groups} onNavigate={onNavigate} />
        </Suspense>
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs font-semibold text-zinc-500">No menu items match.</p>
        ) : null}
      </nav>

      {/* User card */}
      <div className="shrink-0 space-y-2.5 border-t border-white/10 p-3.5">
        {toggleButton}
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
          <div className="flex items-center gap-3">
            <Avatar name={user?.name} presence={Boolean(user)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm leading-[17.5px] font-bold text-zinc-100">
                {user?.name ?? "Loading…"}
              </p>
              <p className="truncate text-xs leading-[15px] font-medium text-zinc-400">
                {user?.email ?? " "}
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between border-t border-white/10 pt-2 text-xs leading-4 font-bold">
            <span className="text-zinc-500">Workspace</span>
            <span className="truncate text-[#f5d27a]">{brand.name}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
