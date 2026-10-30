import type { Metadata } from "next";
import { DashboardView } from "@/features/dashboard/components/dashboard-view";
import { emptyDashboardData } from "@/features/dashboard/types";
import { flattenParams } from "@/features/leads/url";
import { dashboardData } from "@/modules/dashboard/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS } from "@/server/auth/types";
import { getDb } from "@/server/db";
import { getProjectScope } from "@/server/project-scope";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Analytics dashboard for the active project and the user's lead scope. Roles without lead access
 * (HR, accountants) and users with no project see the empty states.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const actor = await requirePageUser();
  const [{ activeProjectId }, params] = await Promise.all([getProjectScope(), searchParams.then(flattenParams)]);
  const result = await dashboardData(getDb(), actor, activeProjectId, params);
  return (
    <DashboardView
      data={result.data ?? emptyDashboardData}
      filters={result.query}
      user={{ id: actor.id, name: actor.name, email: actor.email, role: actor.role, roleLabel: ROLE_LABELS[actor.role] }}
    />
  );
}
