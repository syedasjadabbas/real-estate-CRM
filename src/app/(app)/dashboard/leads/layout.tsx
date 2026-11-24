import { Suspense } from "react";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { findNavItem } from "@/config/navigation";
import { LeadsTabs } from "@/features/leads/components/leads-tabs";
import { canListUnassigned } from "@/modules/leads/claims";
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
  return <LeadsTabs showImports={canSubmitImport(actor)} showUnassigned={canListUnassigned(actor)} verifyCount={verifyCount} />;
}

/** The project these leads belong to (client, 23 Nov 2026); streams in, as it depends on the user. */
async function ActiveProject() {
  const { projects, activeProjectId } = await getProjectScope();
  const name = projects.find((p) => p.id === activeProjectId)?.name;
  return name ? (
    <span title="Active project" className="rounded-full border border-brand/25 bg-brand-50 px-3 py-1 text-sm leading-5 font-black text-brand-700">
      {name}
    </span>
  ) : null;
}

export default function LeadsLayout({ children }: LayoutProps<"/dashboard/leads">) {
  const item = findNavItem("/dashboard/leads")!;
  return (
    <PageStack>
      <PageHeader
        title={item.label}
        description={item.description}
        icon={item.icon}
        actions={
          <Suspense fallback={null}>
            <ActiveProject />
          </Suspense>
        }
      />
      {/* Same tabs every role starts with, until the user's own tabs arrive (instant navigation). */}
      <Suspense fallback={<LeadsTabs />}>
        <RoleTabs />
      </Suspense>
      {children}
    </PageStack>
  );
}
