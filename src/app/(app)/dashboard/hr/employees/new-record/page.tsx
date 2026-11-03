import { ArrowLeft, UserRoundPlus } from "lucide-react";
import { canOpenLeaveAdmin } from "@/modules/leave/service";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { EmployeeProfileForm } from "@/features/hr/components/employee-profile-form";
import { HrTabs } from "@/features/hr/components/hr-tabs";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { canEditEmployeeProfiles } from "@/modules/employees/policy";
import { employeeSuggestions } from "@/modules/employees/service";
import { canViewHolidays } from "@/modules/holidays/policy";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Add employee" };

/** HR record for a staff member without a CRM login (questionnaire Q1; super admin, admin, HR). */
export default async function NewEmployeeRecordPage() {
  const actor = await requirePageUser();
  if (!canEditEmployeeProfiles(actor)) return <RestrictedState />;
  const suggestions = await employeeSuggestions(getDb());
  return (
    <PageStack>
      <PageHeader
        title="Add employee"
        description="An HR record for a staff member who doesn't need a CRM login. To give someone a login, an Admin creates a CRM user instead."
        icon={UserRoundPlus}
        actions={
          <Link href="/dashboard/hr/employees" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to employees
          </Link>
        }
      />
      <HrTabs active="employees" showEmployees showHolidays={canViewHolidays(actor)} showLeave={canOpenLeaveAdmin(actor)} />
      <PanelCard title="HR record" className="max-w-3xl">
        <EmployeeProfileForm
          userId={null}
          record={{ fullName: "", email: null, status: "active" }}
          profile={{ designation: null, department: null, phoneCountryCode: null, phoneNumber: null, joiningDate: null }}
          departments={suggestions.departments}
          designations={suggestions.designations}
        />
      </PanelCard>
    </PageStack>
  );
}
