"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ProjectOption, SessionUser } from "@/lib/session";
import { Header } from "./header";
import { Sidebar } from "./sidebar";

const DESKTOP_QUERY = "(min-width: 1024px)";

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
 * Application frame. Desktop (≥1024px): docked 256px sidebar that the menu button collapses.
 * Below 1024px: sidebar becomes an overlay drawer with a backdrop — same as the reference.
 */
export function AppShell({
  user,
  projects,
  activeProjectId,
  children,
}: {
  user: SessionUser | null;
  projects: ProjectOption[];
  activeProjectId: string | null;
  children: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const toggle = useCallback(() => {
    if (window.matchMedia(DESKTOP_QUERY).matches) setDesktopOpen((open) => !open);
    else setDrawerOpen((open) => !open);
  }, []);

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
          "fixed inset-y-0 left-0 z-40 w-64 border-r border-zinc-200/80 bg-white shadow-hairline",
          "transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
          desktopOpen ? "lg:translate-x-0" : "lg:-translate-x-full",
        )}
      >
        <Sidebar user={user} onNavigate={closeDrawer} />
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
          desktopOpen && "lg:pl-64",
        )}
      >
        <Header
          user={user}
          projects={projects}
          activeProjectId={activeProjectId}
          sidebarOpen={isDesktop ? desktopOpen : drawerOpen}
          onToggleSidebar={toggle}
        />
        <main className="min-w-0 flex-1 px-4 py-6 md:p-6 lg:px-10 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
