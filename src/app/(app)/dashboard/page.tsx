import type { Metadata } from "next";
import { DashboardView } from "@/features/dashboard/components/dashboard-view";
import { emptyDashboardData } from "@/features/dashboard/types";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS } from "@/server/auth/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const actor = await requirePageUser();
  // Dashboard analytics are wired to PostgreSQL in a later stage; widgets show empty states until then.
  return (
    <DashboardView
      data={emptyDashboardData}
      user={{ id: actor.id, name: actor.name, email: actor.email, role: actor.role, roleLabel: ROLE_LABELS[actor.role] }}
    />
  );
}
