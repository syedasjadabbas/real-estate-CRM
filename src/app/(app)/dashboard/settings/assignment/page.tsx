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

export const metadata: Metadata = { title: "Assignment & agent scores" };

/** How new leads are assigned automatically. Super Admins and Admins. */
export default async function AssignmentSettingsPage() {
  const actor = await requirePageUser();
  if (!canManageAssignment(actor)) return <RestrictedState />;
  const settings = await readAssignmentSettings(getDb());
  return (
    <PageStack>
      <PageHeader
        title="Assignment & agent scores"
        description="Two separate things: who gets each new lead (a fixed rule), and how each agent's 0–100 score is worked out (the settings below). Every change is recorded in the audit log."
        icon={Shuffle}
      />
      <SettingsTabs active="assignment" showBackups={canViewBackups(actor)} />
      <PanelCard title="1 · Who gets a new lead">
        <div className="space-y-2 text-xs text-zinc-700">
          <p>
            A new lead with no owner chosen (from an approved import, or added by an Admin without picking an agent) goes to the <strong>next agent in turn</strong>,
            in name order, starting again from the top: like dealing cards, everyone gets an equal share whatever their score.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Skipped today, and back in the rotation when they return: agents on approved leave, marked &quot;Leads off&quot; in today&apos;s team roster, or on
              the weekly day off set in HR → Attendance (unless the roster says they&apos;re working).
            </li>
            <li>A returning customer goes back to the agent who handled them before.</li>
            <li>A lead an agent adds stays with that agent.</li>
            <li>If no agent is available, the lead waits on the Unassigned list, where an agent can claim it or an Admin can assign it.</li>
          </ul>
          <p className="text-[11px] text-zinc-500">This rule has no settings. To keep someone out for a day, mark them &quot;Leads off&quot; in the team roster.</p>
        </div>
      </PanelCard>
      <PanelCard title="2 · Agent scores">
        <p className="mb-4 text-xs text-zinc-600">
          Every agent gets a score from 0 to 100, shown on My Teams, the dashboard, Performance and their work profile. It&apos;s a quick health check and{" "}
          <strong>does not decide who gets leads</strong>. It is made of two parts: follow-up performance and conversion. Example: performance 70 and
          conversion 50, with weights 30 and 20, give (70×30 + 50×20) ÷ 50 = <strong>62</strong>.
        </p>
        <AssignmentSettingsForm settings={settings} />
      </PanelCard>
    </PageStack>
  );
}
