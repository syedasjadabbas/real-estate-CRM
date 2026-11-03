import { UserPlus, UserRoundPlus, Users } from "lucide-react";
import { canOpenLeaveAdmin } from "@/modules/leave/service";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { EmployeesToolbar } from "@/features/hr/components/employees-toolbar";
import { HrTabs } from "@/features/hr/components/hr-tabs";
import { formatListedOn } from "@/features/inventory/format";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams, withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { canManageAccounts } from "@/modules/accounts/policy";
import { canEditEmployeeProfiles, canViewEmployees } from "@/modules/employees/policy";
import { listEmployees } from "@/modules/employees/service";
import type { EmployeeSort } from "@/modules/employees/validation";
import { canViewHolidays } from "@/modules/holidays/policy";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS } from "@/server/auth/types";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Employees" };

const COLUMNS: { label: string; sort?: EmployeeSort }[] = [
  { label: "Name", sort: "name" },
  { label: "Designation", sort: "designation" },
  { label: "Department", sort: "department" },
  { label: "Role", sort: "role" },
  { label: "Phone" },
  { label: "Joining date", sort: "joiningDate" },
  { label: "Account", sort: "status" },
  { label: "Actions" },
];

const none = <span className="text-zinc-400">—</span>;

/** FR-140 directory of CRM accounts with their HR profile fields (HR plan §13, A + B). */
export default async function EmployeesPage({ searchParams }: PageProps<"/dashboard/hr/employees">) {
  const actor = await requirePageUser();
  if (!canViewEmployees(actor)) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const data = await listEmployees(getDb(), actor, params);
  const canEdit = canEditEmployeeProfiles(actor);
  const { tiles, rows } = data;
  const filtered = Boolean(params.q || params.role || params.status || params.department);
  const sortHref = (key: EmployeeSort) =>
    withParams("/dashboard/hr/employees", params, { sort: key, dir: data.query.sort === key && data.query.dir === "asc" ? "desc" : "asc", page: null });

  return (
    <PageStack>
      <PageHeader
        title="Employees"
        description={
          canEdit
            ? canManageAccounts(actor)
              ? "CRM accounts with their HR profile: designation, department, phone and joining date. Open an employee to manage their account."
              : "CRM accounts with their HR profile: designation, department, phone and joining date. Account details are managed by Admins."
            : "CRM accounts with their HR profile (view only)."
        }
        icon={Users}
        actions={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/hr/employees/new-record" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                <UserRoundPlus aria-hidden="true" className="size-4" />
                Add employee (no login)
              </Link>
              {canManageAccounts(actor) ? (
                <Link href="/dashboard/hr/employees/new" className={buttonClasses({ variant: "primary", size: "lg" })}>
                  <UserPlus aria-hidden="true" className="size-4" />
                  New CRM user
                </Link>
              ) : null}
            </div>
          ) : null
        }
      />
      <HrTabs active="employees" showEmployees showHolidays={canViewHolidays(actor)} showLeave={canOpenLeaveAdmin(actor)} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MiniStat label="Accounts" value={formatInt(tiles.accounts)} caption="CRM logins" />
        <MiniStat label="No CRM login" value={formatInt(tiles.noLogin)} caption="HR records only" />
        <MiniStat label="Active" value={formatInt(tiles.active)} caption="Can sign in" />
        <MiniStat label="Inactive" value={formatInt(tiles.inactive)} caption="Cannot sign in" />
        <MiniStat label="Profiles completed" value={formatInt(tiles.completed)} caption="All HR fields filled" />
      </div>
      <EmployeesToolbar params={params} total={data.total} departments={data.departments} />
      {rows.length === 0 ? (
        <EmptyState>{filtered ? "No employees match your search or filters." : "No CRM accounts found."}</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-hairline">
          <div className="relative max-h-[600px] overflow-auto">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-100">
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  {COLUMNS.map((c) => (
                    <th
                      key={c.label}
                      scope="col"
                      aria-sort={c.sort && c.sort === data.query.sort ? (data.query.dir === "asc" ? "ascending" : "descending") : undefined}
                      className="px-3 py-4 whitespace-nowrap"
                    >
                      {c.sort ? (
                        <Link href={sortHref(c.sort)} className="inline-flex items-center gap-1.5 hover:text-zinc-900" aria-label={`Sort by ${c.label}`}>
                          {c.label}
                          <span aria-hidden="true" className="flex flex-col text-[7px] leading-[7px]">
                            <span className={cn(data.query.sort === c.sort && data.query.dir === "asc" ? "text-brand" : "text-zinc-300")}>▲</span>
                            <span className={cn(data.query.sort === c.sort && data.query.dir === "desc" ? "text-brand" : "text-zinc-300")}>▼</span>
                          </span>
                        </Link>
                      ) : (
                        c.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100/80 last:border-b-0 hover:bg-zinc-50/60">
                    <td className="px-3 py-3">
                      <Link href={`/dashboard/hr/employees/${r.id}`} className="block font-bold text-zinc-900 hover:text-brand hover:underline">
                        {r.name}
                      </Link>
                      <span className="block text-[11px] text-zinc-500">{r.email ?? "No email"}</span>
                    </td>
                    <td className="max-w-[220px] px-3 py-3 break-words whitespace-normal">{r.designation ?? none}</td>
                    <td className="max-w-[220px] px-3 py-3 break-words whitespace-normal">{r.department ?? none}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{r.role ? ROLE_LABELS[r.role] : <span className="text-zinc-500">No CRM login</span>}</td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">{r.phone ?? none}</td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">{r.joiningDate ? formatListedOn(r.joiningDate) : none}</td>
                    <td className="px-3 py-3">
                      <StatusTag tone={r.status === "active" ? "brand" : "neutral"}>{r.status === "active" ? "Active" : "Inactive"}</StatusTag>
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/dashboard/hr/employees/${r.id}`}
                        className="inline-flex h-7 items-center rounded-xl border border-zinc-200/80 bg-white px-2.5 text-[11px] font-bold text-zinc-800 shadow-hairline hover:bg-zinc-50"
                        aria-label={`${canEdit ? "Open profile" : "View"} ${r.name}`}
                      >
                        {canEdit ? "Open profile" : "View"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Pagination page={data.page} pageCount={data.pageCount} total={data.total} params={params} />
      <p className="text-[11px] text-zinc-500">
        Lists CRM accounts and HR records for staff without a CRM login. Accounts are created and deactivated by Admins and Super Admins.
      </p>
    </PageStack>
  );
}
