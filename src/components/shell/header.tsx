"use client";

import { Bell, LogOut, Menu, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logoutAction, setActiveProjectAction } from "@/features/auth/actions";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses, IconButton } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ProjectOption, SessionUser } from "@/lib/session";

function ProjectSelector({
  projects,
  activeProjectId,
  loading,
}: {
  projects: ProjectOption[];
  activeProjectId: string | null;
  loading: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const choose = (id: string) => {
    if (id === activeProjectId) return;
    setError(null);
    startTransition(async () => {
      const result = await setActiveProjectAction(id);
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  };

  return (
    <div
      aria-busy={pending}
      title={error ?? undefined}
      className="flex h-9 w-full max-w-xl items-center gap-2 rounded-full border border-zinc-200/80 bg-zinc-50/80 pr-1 pl-3 shadow-hairline"
    >
      <span className="text-[11px] font-semibold tracking-[0.025em] text-zinc-600 uppercase">Project</span>
      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-zinc-200" />
      <Select
        label="Active project"
        className="flex-1"
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
        value={activeProjectId}
        onChange={choose}
        placeholder={loading ? "Loading…" : "No projects yet"}
        emptyMessage="Projects are added in the Projects module."
        disabled={projects.length === 0 || pending}
      />
    </div>
  );
}

export function Header({
  user,
  projects,
  activeProjectId,
  sidebarOpen,
  onToggleSidebar,
}: {
  user: SessionUser | null;
  projects: ProjectOption[];
  activeProjectId: string | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/60 bg-white/95 backdrop-blur-sm">
      <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 sm:flex-nowrap sm:px-6 sm:py-0">
        {/* Left: menu toggle + user chip */}
        <div className="flex min-w-0 items-center gap-3">
          <IconButton
            label={sidebarOpen ? "Hide navigation" : "Show navigation"}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
            onClick={onToggleSidebar}
          >
            <Menu aria-hidden="true" className="size-5" />
          </IconButton>
          <div className="flex h-[39px] min-w-0 items-center gap-2.5 rounded-xl border border-zinc-200/80 bg-zinc-50/50 py-1 pr-1 pl-1.5 shadow-hairline sm:pr-3">
            <Avatar name={user?.name} size="sm" presence={Boolean(user)} />
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-xs leading-[15px] font-bold">{user?.name ?? "Loading…"}</p>
              <p className="hidden truncate text-[10px] leading-[13px] font-medium text-zinc-600 lg:block">
                {user?.email ?? " "}
              </p>
            </div>
          </div>
        </div>

        {/* Center: project scope (moves to its own row on phones) */}
        <div className="order-last flex w-full justify-center px-1 sm:order-none sm:w-auto sm:flex-1">
          <ProjectSelector projects={projects} activeProjectId={activeProjectId} loading={!user} />
        </div>

        {/* Right: notifications + session action */}
        <div className="ml-auto flex items-center gap-3 sm:ml-0">
          {user && (user.role === "super_admin" || user.role === "admin") ? (
            <Link
              href="/dashboard/settings/security"
              aria-label="Security settings"
              title="Security settings"
              className={buttonClasses({ variant: "secondary", className: "px-2.5" })}
            >
              <ShieldCheck aria-hidden="true" className="size-[18px]" />
            </Link>
          ) : null}
          <IconButton label="Notifications" size="md">
            <Bell aria-hidden="true" className="size-[18px]" />
          </IconButton>
          {user ? (
            <form action={logoutAction}>
              <button
                type="submit"
                aria-label="Log out"
                className={buttonClasses({ variant: "secondary", className: "px-2.5 sm:px-3" })}
              >
                <LogOut aria-hidden="true" className="size-4" />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </form>
          ) : (
            // Session still loading (signed-out visitors are redirected): hold the button's space.
            <span aria-hidden="true" className={buttonClasses({ variant: "secondary", className: "invisible px-2.5 sm:px-3" })}>
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Log out</span>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
