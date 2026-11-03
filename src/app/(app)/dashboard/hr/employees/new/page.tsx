import { ArrowLeft, UserPlus } from "lucide-react";
import { canOpenLeaveAdmin } from "@/modules/leave/service";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { AccountCreateForm } from "@/features/hr/components/account-create-form";
import { HrTabs } from "@/features/hr/components/hr-tabs";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { canManageAccounts, grantableRoles } from "@/modules/accounts/policy";
import { linkableRecords } from "@/modules/accounts/service";
import { getDb } from "@/server/db";
import { canViewHolidays } from "@/modules/holidays/policy";
import { requirePageUser } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "New CRM user" };

/** Create a CRM account (Admin, Super Admin; questionnaire Q2). */
export default async function NewAccountPage({ searchParams }: PageProps<"/dashboard/hr/employees/new">) {
  const actor = await requirePageUser();
  if (!canManageAccounts(actor)) return <RestrictedState />;
  const { record } = await searchParams;
  const records = await linkableRecords(getDb(), actor);
  return (
    <PageStack>
      <PageHeader
        title="New CRM user"
        description="Creates a sign-in account. Add the HR profile details on the employee page afterwards."
        icon={UserPlus}
        actions={
          <Link href="/dashboard/hr/employees" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to employees
          </Link>
        }
      />
      <HrTabs active="employees" showEmployees showHolidays={canViewHolidays(actor)} showLeave={canOpenLeaveAdmin(actor)} />
      <PanelCard title="Account" className="max-w-3xl">
        <AccountCreateForm roles={grantableRoles(actor)} records={records} recordId={typeof record === "string" ? record : ""} />
      </PanelCard>
    </PageStack>
  );
}
