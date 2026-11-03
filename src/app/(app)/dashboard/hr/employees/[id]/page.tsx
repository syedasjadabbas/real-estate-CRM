import { ArrowLeft, UserRound } from "lucide-react";
import { canOpenLeaveAdmin, employeeLeaveBalance } from "@/modules/leave/service";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { AccountControls } from "@/features/hr/components/account-controls";
import { EmployeeProfileForm } from "@/features/hr/components/employee-profile-form";
import { HrTabs } from "@/features/hr/components/hr-tabs";
import { formatListedOn } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { canManageAccount, canManageAccounts, grantableRoles } from "@/modules/accounts/policy";
import { leadReceivers, ownedLeadSummary } from "@/modules/accounts/service";
import { canEditEmployeeProfiles, canViewEmployees } from "@/modules/employees/policy";
import { employeeSuggestions, getEmployee } from "@/modules/employees/service";
import { canViewHolidays } from "@/modules/holidays/policy";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS } from "@/server/auth/types";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Employee" };

const FIELD_LABELS: Record<string, string> = {
  designation: "Designation",
  department: "Department",
  phoneE164: "Phone",
  joiningDate: "Joining date",
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold break-words text-zinc-900">{children}</dd>
    </div>
  );
}

const show = (field: string, value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "joiningDate") return formatListedOn(String(value));
  return String(value);
};

/** One employee: account facts (read-only), HR profile (editable by super admin, admin, HR), history. */
export default async function EmployeePage({ params }: PageProps<"/dashboard/hr/employees/[id]">) {
  const actor = await requirePageUser();
  if (!canViewEmployees(actor)) return <RestrictedState />;
  const { id } = await params;
  const db = getDb();
  let data: Awaited<ReturnType<typeof getEmployee>>;
  try {
    data = await getEmployee(db, actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { employee: e, history } = data;
  const canEdit = canEditEmployeeProfiles(actor);
  const suggestions = canEdit ? await employeeSuggestions(db) : { departments: [], designations: [] };
  const manage = e.role !== null && canManageAccount(actor, e.role);
  // Shown to HR, admins and the person's team manager; anyone else simply doesn't get the panel.
  const balance =
    e.role !== null && canOpenLeaveAdmin(actor)
      ? await employeeLeaveBalance(db, actor, e.id).catch((error: unknown) => {
          if (error instanceof AppError && error.code === "FORBIDDEN") return null;
          throw error;
        })
      : null;
  const [leadCounts, receivers] = manage ? await Promise.all([ownedLeadSummary(db, actor, e.id), leadReceivers(db, actor, e.id)]) : [null, []];

  return (
    <PageStack>
      <PageHeader
        title={e.name}
        description={[e.designation, e.department].filter(Boolean).join(" · ") || "No HR profile details yet."}
        icon={UserRound}
        actions={
          <Link href="/dashboard/hr/employees" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to employees
          </Link>
        }
      />
      <HrTabs active="employees" showEmployees showHolidays={canViewHolidays(actor)} showLeave={canOpenLeaveAdmin(actor)} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <PanelCard title="CRM account">
            {e.role === null ? (
              <p className="text-sm text-zinc-700">
                No CRM login. HR keeps this record for a staff member who doesn&apos;t sign in to the CRM.
                {e.email ? ` Email on record: ${e.email}.` : ""}
                {canManageAccounts(actor) && e.status === "active" ? (
                  <Link href={`/dashboard/hr/employees/new?record=${e.id}`} className="mt-2 block text-xs font-bold text-brand hover:underline">
                    Create a CRM login for this employee
                  </Link>
                ) : null}
              </p>
            ) : (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Fact label="Name">{e.name}</Fact>
              <Fact label="Email">{e.email}</Fact>
              <Fact label="Role">{ROLE_LABELS[e.role]}</Fact>
              <Fact label="Account status">
                <StatusTag tone={e.status === "active" ? "brand" : "neutral"}>{e.status === "active" ? "Active" : "Inactive"}</StatusTag>
              </Fact>
              <Fact label="Account created">{formatDateTime(e.createdAt)}</Fact>
            </dl>
            )}
            {e.role === null || (manage && leadCounts) ? null : (
              <p className="mt-4 text-[11px] text-zinc-500">
                {canManageAccounts(actor) ? "Only a Super Admin can manage Super Admin accounts." : "Account details are managed by Admins and Super Admins."}
              </p>
            )}
          </PanelCard>
          {manage && leadCounts ? (
            <PanelCard title="Manage account">
              <AccountControls account={{ id: e.id, name: e.name, role: e.role!, status: e.status }} roles={grantableRoles(actor)} isSelf={actor.id === e.id} leads={leadCounts} receivers={receivers} />
            </PanelCard>
          ) : null}
          {balance ? (
            <PanelCard title={`Leave balance · ${balance.year}`}>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Fact label="Allowance">
                  {balance.allowance}
                  {balance.provisional ? <span className="block text-[11px] font-medium text-amber-800">prorated (provisional)</span> : null}
                </Fact>
                <Fact label="Taken">{balance.granted}</Fact>
                <Fact label="Pending">{balance.pending}</Fact>
                <Fact label="Remaining">{balance.remaining}</Fact>
              </dl>
            </PanelCard>
          ) : null}
          <PanelCard title="HR profile">
            {canEdit ? (
              <EmployeeProfileForm
                userId={e.id}
                record={e.role === null ? { fullName: e.name, email: e.email, status: e.status } : undefined}
                profile={{ designation: e.designation, department: e.department, phoneCountryCode: e.phoneCountryCode, phoneNumber: e.phoneNumber, joiningDate: e.joiningDate }}
                departments={suggestions.departments}
                designations={suggestions.designations}
              />
            ) : (
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Fact label="Designation">{e.designation ?? "—"}</Fact>
                <Fact label="Department">{e.department ?? "—"}</Fact>
                <Fact label="Phone">{e.phone ?? "—"}</Fact>
                <Fact label="Joining date">{e.joiningDate ? formatListedOn(e.joiningDate) : "—"}</Fact>
              </dl>
            )}
            {e.profileUpdatedAt ? (
              <p className="mt-4 text-[11px] text-zinc-500">
                Last updated by {e.profileUpdatedBy ?? "—"} · {formatDateTime(e.profileUpdatedAt)}
              </p>
            ) : null}
          </PanelCard>
        </div>
        <PanelCard title="Profile history" className="min-w-0 self-start">
          {history.length === 0 ? (
            <EmptyState size="sm">No profile changes recorded yet.</EmptyState>
          ) : (
            <ol className="space-y-3">
              {history.map((h) => {
                const before = (h.before ?? {}) as Record<string, unknown>;
                const after = (h.after ?? {}) as Record<string, unknown>;
                const fields = Object.keys(after).filter((k) => k in FIELD_LABELS);
                return (
                  <li key={h.id} className="border-b border-zinc-100 pb-3 text-xs last:border-b-0 last:pb-0">
                    <p className="text-[11px] text-zinc-500">
                      {h.actorName ?? "System"} · {formatDateTime(h.createdAt)}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {fields.map((k) => (
                        <li key={k} className="break-words">
                          <span className="font-bold">{FIELD_LABELS[k]}:</span> {show(k, before[k])} → <span className="font-semibold">{show(k, after[k])}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          )}
        </PanelCard>
      </div>
    </PageStack>
  );
}
