import { Suspense } from "react";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { findNavItem } from "@/config/navigation";
import { LeadsTabs } from "@/features/leads/components/leads-tabs";
import { canSubmitImport } from "@/modules/leads/imports";
import { canVerifyLeads, pendingVerificationCount } from "@/modules/leads/verification";
import { getDb } from "@/server/db";
import { getProjectScope } from "@/server/project-scope";
import { requirePageUser } from "@/server/auth/current-user";

/** The tabs depend on the signed-in user, so they stream in; the header and the page don't wait for them. */
async function RoleTabs() {
  // Imports is an Admin and Super Admin page; other roles don't see the tab (the page refuses them too).
  const actor = await requirePageUser();
  // Verify lists agents' leads waiting for an Admin or Super Admin (lead verification).
  const verifyCount = canVerifyLeads(actor) ? await pendingVerificationCount(getDb(), actor, (await getProjectScope()).activeProjectId) : null;
  return <LeadsTabs showImports={canSubmitImport(actor)} showUnassigned={actor.role !== "agent"} verifyCount={verifyCount} />;
}

export default function LeadsLayout({ children }: LayoutProps<"/dashboard/leads">) {
  const item = findNavItem("/dashboard/leads")!;
  return (
    <PageStack>
      <PageHeader title={item.label} description={item.description} icon={item.icon} />
      {/* Same tabs every role starts with, until the user's own tabs arrive (instant navigation). */}
      <Suspense fallback={<LeadsTabs />}>
        <RoleTabs />
      </Suspense>
      {children}
    </PageStack>
  );
}
