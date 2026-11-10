import { Shuffle } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { RestrictedState } from "@/components/ui/empty-state";
import { SettingsTabs } from "@/features/audit/components/audit-controls";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { AssignmentSettingsForm } from "@/features/leads/components/assignment-settings-form";
import { canViewBackups } from "@/modules/backups/policy";
import { canManageAssignment, readAssignmentSettings } from "@/modules/leads/assignment";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Assignment settings" };

/** How new leads are assigned automatically. Super Admins and Admins. */
export default async function AssignmentSettingsPage() {
  const actor = await requirePageUser();
  if (!canManageAssignment(actor)) return <RestrictedState />;
  const settings = await readAssignmentSettings(getDb());
  return (
    <PageStack>
      <PageHeader
        title="Assignment"
        description="How new leads find an owner. Returning customers always go to their original agent; the rest are scored. Every change is recorded in the audit log."
        icon={Shuffle}
      />
      <SettingsTabs active="assignment" showBackups={canViewBackups(actor)} />
      <PanelCard title="Automatic assignment">
        <p className="mb-4 text-xs text-zinc-600">
          Eligible agents are active, in an active team, not on leave or marked &quot;Leads off&quot; in today&apos;s roster, not on their team weekend, and below the
          maximum load. Among them the highest weighted score wins; ties go to the lighter load. Each decision and its scores are kept in the assignment history.
        </p>
        <AssignmentSettingsForm settings={settings} />
      </PanelCard>
    </PageStack>
  );
}
