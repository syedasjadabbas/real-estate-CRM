import { PageHeader, PageStack } from "@/components/shell/page-header";
import { findNavItem } from "@/config/navigation";
import { LeadsTabs } from "@/features/leads/components/leads-tabs";
import { canSubmitImport } from "@/modules/leads/imports";
import { canVerifyLeads, pendingVerificationCount } from "@/modules/leads/verification";
import { getDb } from "@/server/db";
import { getProjectScope } from "@/server/project-scope";
import { requirePageUser } from "@/server/auth/current-user";

export default async function LeadsLayout({ children }: LayoutProps<"/dashboard/leads">) {
  const item = findNavItem("/dashboard/leads")!;
  // Imports is an Admin and Super Admin page; other roles don't see the tab (the page refuses them too).
  const actor = await requirePageUser();
  // Verify lists agents' leads waiting for an Admin or Super Admin (lead verification).
  const verifyCount = canVerifyLeads(actor) ? await pendingVerificationCount(getDb(), actor, (await getProjectScope()).activeProjectId) : null;
  return (
    <PageStack>
      <PageHeader title={item.label} description={item.description} icon={item.icon} />
      <LeadsTabs showImports={canSubmitImport(actor)} showUnassigned={actor.role !== "agent"} verifyCount={verifyCount} />
      {children}
    </PageStack>
  );
}
