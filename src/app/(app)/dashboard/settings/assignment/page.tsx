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
        description="How new leads find an owner, and how agents are scored. Every change is recorded in the audit log."
        icon={Shuffle}
      />
      <SettingsTabs active="assignment" showBackups={canViewBackups(actor)} />
      <PanelCard title="Automatic assignment and agent scores">
        <p className="mb-4 text-xs text-zinc-600">
          New leads with no chosen owner (imports, the API, or added by hand) go to agents in turn, one each in name order, looping back to the first: an equal
          share whatever their performance. Agents on leave, marked &quot;Leads off&quot; in today&apos;s roster or on their team weekend are skipped and rejoin
          when back. Returning customers stay with their original agent. The weights below no longer choose owners: they set the agent and team scores shown on
          My Teams and the dashboard.
        </p>
        <AssignmentSettingsForm settings={settings} />
      </PanelCard>
    </PageStack>
  );
}
