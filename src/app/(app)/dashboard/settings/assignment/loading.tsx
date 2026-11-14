import { LeadsSkeleton } from "@/features/leads/components/leads-skeleton";

/**
 * Header and panel placeholders while the assignment settings load (same rhythm as Leads). Without it
 * a navigation here waited on readAssignmentSettings before showing anything (Next.js instant insight).
 */
export default function AssignmentSettingsLoading() {
  return <LeadsSkeleton />;
}
