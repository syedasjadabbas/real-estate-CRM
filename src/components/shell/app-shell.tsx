"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ProjectOption, SessionUser } from "@/lib/session";
import type { TodayAttendance } from "@/features/attendance/components/check-in-button";
import { Header } from "./header";
import { Sidebar } from "./sidebar";

const DESKTOP_QUERY = "(min-width: 1024px)";
/** This browser's choice of full menu or icon rail (a convenience only; expanded when unset). */
const MENU_KEY = "mz.sidebar.expanded";

function readExpanded() {
  try {
    return window.localStorage.getItem(MENU_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveExpanded(expanded: boolean) {
  try {
    window.localStorage.setItem(MENU_KEY, expanded ? "1" : "0");
  } catch {
    // Private windows and blocked storage: the menu still works, it just isn't remembered.
  }
}

function subscribeDesktop(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** True at ≥1024px. Server render assumes desktop (the docked layout). */
function useIsDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

/**
 * Application frame. Desktop (≥1024px): a docked sidebar that starts as the full 256px menu and
 * collapses to a 76px icon rail (owner, 16 Nov 2026) from the menu button or its own Collapse button;
 * the choice is remembered on this browser. Below 1024px: an overlay drawer with the full menu.
 */
export function AppShell({
  user,
  projects,
  activeProjectId,
  today = null,
  children,
}: {
  user: SessionUser | null;
  projects: ProjectOption[];
  activeProjectId: string | null;
  today?: TodayAttendance | null;
  children: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Restore this browser's choice after the first paint (the server always renders the full menu).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser storage once on mount
    if (!readExpanded()) setDesktopOpen(false);
  }, []);

  const toggleDesktop = useCallback(() => {
    setDesktopOpen((open) => {
      saveExpanded(!open);
      return !open;
    });
  }, []);

  const toggle = useCallback(() => {
    if (window.matchMedia(DESKTOP_QUERY).matches) toggleDesktop();
    else setDrawerOpen((open) => !open);
  }, [toggleDesktop]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-dvh bg-canvas">
      <aside
        id="app-sidebar"
        aria-label="Sidebar"
        className={cn(
          // Dark premium sidebar (owner, 16 Nov 2026); the page itself stays light.
          "fixed inset-y-0 left-0 z-40 w-64 border-r border-black/40 bg-[#1c1b19] shadow-hairline",
          "transition-[transform,width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
          desktopOpen ? "lg:w-64" : "lg:w-[76px]",
        )}
      >
        <Sidebar
          user={user}
          onNavigate={closeDrawer}
          collapsed={isDesktop && !desktopOpen}
          onToggleCollapsed={isDesktop ? toggleDesktop : undefined}
        />
      </aside>

      {/* Drawer backdrop (below 1024px only) */}
      <div
        aria-hidden="true"
        onClick={closeDrawer}
        className={cn(
          "fixed inset-0 z-30 bg-zinc-950/20 backdrop-blur-[1px] transition-opacity lg:hidden",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <div
        className={cn(
          "flex min-h-dvh min-w-0 flex-col transition-[padding] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          desktopOpen ? "lg:pl-64" : "lg:pl-[76px]",
        )}
      >
        <Header
          user={user}
          projects={projects}
          activeProjectId={activeProjectId}
          today={today}
          sidebarOpen={isDesktop ? desktopOpen : drawerOpen}
          onToggleSidebar={toggle}
        />
        <main className="min-w-0 flex-1 px-4 py-6 md:p-6 lg:px-10 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
