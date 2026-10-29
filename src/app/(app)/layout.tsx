import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { DashboardSkeleton } from "@/features/dashboard/components/dashboard-skeleton";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS } from "@/server/auth/types";
import { getProjectScope } from "@/server/project-scope";

/** Static shell shown while the session is read (Cache Components: request data streams in). */
function ShellFallback() {
  return (
    <AppShell user={null} projects={[]} activeProjectId={null}>
      <DashboardSkeleton />
    </AppShell>
  );
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const actor = await requirePageUser();
  const { projects, activeProjectId } = await getProjectScope();
  return (
    <AppShell
      user={{ id: actor.id, name: actor.name, email: actor.email, role: actor.role, roleLabel: ROLE_LABELS[actor.role] }}
      projects={projects}
      activeProjectId={activeProjectId}
    >
      {children}
    </AppShell>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}
