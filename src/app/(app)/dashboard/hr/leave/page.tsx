import { Plane } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { HrTabs } from "@/features/hr/components/hr-tabs";
import { formatListedOn } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { CancelApprovedLeave, LeaveDecision, LeaveSettingsForm } from "@/features/leave/components/leave-admin";
import { LeaveListFilters, LeaveSortHeader } from "@/features/leave/components/leave-list-controls";
import { LeaveStatusTag } from "@/features/leave/components/leave-status";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams } from "@/features/leads/url";
import { canViewEmployees } from "@/modules/employees/policy";
import { canViewHolidays } from "@/modules/holidays/policy";
import { CROSS_YEAR_HELD_NOTE, isCrossYear, LEAVE_TYPE_LABELS, STAFF_STEP_LABELS } from "@/modules/leave/rules";
import { businessToday } from "@/modules/bookings/today";
import { canCancelApprovedLeave, canManageLeaveSettings, canOpenLeaveAdmin, leaveBalances, leaveOverview, type LeaveRow } from "@/modules/leave/service";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Leave" };

const PATH = "/dashboard/hr/leave";
const when = (r: LeaveRow) => `${formatListedOn(r.startDate)}${r.endDate !== r.startDate ? ` – ${formatListedOn(r.endDate)}` : ""} · ${r.days} day${r.days === 1 ? "" : "s"}`;

/** HR → Leave (FR-142): approvals waiting for you, cancellation requests, all requests and settings. */
export default async function LeavePage({ searchParams }: PageProps<"/dashboard/hr/leave">) {
  const actor = await requirePageUser();
  if (!canOpenLeaveAdmin(actor)) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const thisYear = Number(businessToday().slice(0, 4));
  const asked = Number(params.year);
  // Calendar years only (C-11); out-of-range values fall back to this year.
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= thisYear + 1 ? asked : thisYear;
  const db = getDb();
  const [data, balances] = await Promise.all([leaveOverview(db, actor, year, params), leaveBalances(db, actor, year)]);
  const sortHeader = (column: Parameters<typeof LeaveSortHeader>[0]["column"], label: string) => (
    <th scope="col" className="py-2 pr-3" aria-sort={data.query.sort === column ? (data.query.dir === "asc" ? "ascending" : "descending") : undefined}>
      <LeaveSortHeader path={PATH} params={params} column={column} label={label} sort={data.query.sort} dir={data.query.dir} />
    </th>
  );
  const { settings } = data;
  const stepNote = (r: LeaveRow) =>
    r.approvalPath === "senior"
      ? "Super Admin approval"
      : `Step ${r.currentStep} of 2 · ${(r.currentStep === 1 ? settings.staffStep1 : settings.staffStep2) ? STAFF_STEP_LABELS[(r.currentStep === 1 ? settings.staffStep1 : settings.staffStep2)!] : "approver not set"}`;

  return (
    <PageStack>
      <PageHeader title="Leave" description={`Leave requests and balances for ${data.year}. Days are calendar days.`} icon={Plane} />
      <HrTabs active="leave" showEmployees={canViewEmployees(actor)} showHolidays={canViewHolidays(actor)} showLeave />
      {!settings.staffStep1 ? (
        <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          Staff leave approval steps are not set yet: agents&apos; and accountants&apos; requests stay pending until the company confirms who approves first and second.
        </p>
      ) : null}

      <PanelCard title={`Waiting for your decision · ${data.decidable.length}`}>
        {data.decidable.length === 0 ? (
          <EmptyState size="sm">Nothing waiting for you.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100" aria-label="Leave waiting for your decision">
            {data.decidable.map((r) => (
              <li key={r.id} className="space-y-2 py-3 first:pt-0">
                <p className="text-sm font-bold text-zinc-900">
                  {r.userName} · {LEAVE_TYPE_LABELS[r.type]} · {when(r)}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {stepNote(r)}
                  {r.reason ? ` · ${r.reason}` : ""}
                </p>
                <LeaveDecision id={r.id} name={r.userName} kind="approval" />
              </li>
            ))}
          </ul>
        )}
      </PanelCard>

      {canCancelApprovedLeave(actor) ? (
        <PanelCard title={`Cancellation requests · ${data.cancellations.length}`}>
          {data.cancellations.length === 0 ? (
            <EmptyState size="sm">No cancellation requests.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {data.cancellations.map((r) => (
                <li key={r.id} className="space-y-2 py-3 first:pt-0">
                  <p className="text-sm font-bold text-zinc-900">
                    {r.userName} · {LEAVE_TYPE_LABELS[r.type]} · {when(r)}
                  </p>
                  <LeaveDecision id={r.id} name={r.userName} kind="cancellation" />
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      ) : null}

      <PanelCard title={`All requests · ${data.year} · ${data.total}`}>
        <div className="mb-3">
          <LeaveListFilters path={PATH} params={params} years={data.years} year={data.year} />
        </div>
        {data.rows.length === 0 ? (
          <EmptyState size="sm">{params.q || params.status || params.type ? "No leave requests match these filters." : `No leave requests in ${data.year}.`}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs" aria-label="All leave requests">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  {sortHeader("employee", "Employee")}
                  {sortHeader("type", "Type")}
                  {sortHeader("dates", "Dates")}
                  {sortHeader("status", "Status")}
                  {sortHeader("requested", "Requested")}
                  <th scope="col" className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 align-top last:border-b-0">
                    <td className="py-2 pr-3">
                      <span className="font-bold">{r.userName}</span>
                      <span className="block text-[11px] text-zinc-500">{ROLE_LABELS[r.userRole as Role]}</span>
                    </td>
                    <td className="py-2 pr-3">{LEAVE_TYPE_LABELS[r.type]}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{when(r)}</td>
                    <td className="py-2 pr-3">
                      <LeaveStatusTag status={r.status} />
                      {r.status === "pending" ? <span className="mt-1 block text-[11px] text-zinc-500">{isCrossYear(r) ? CROSS_YEAR_HELD_NOTE : stepNote(r)}</span> : null}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-zinc-600">{formatListedOn(businessToday(r.createdAt))}</td>
                    <td className="py-2">{canCancelApprovedLeave(actor) && r.status === "approved" && r.userId !== actor.id ? <CancelApprovedLeave id={r.id} name={r.userName} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.total > 0 ? (
          <div className="mt-3">
            <Pagination page={data.page} pageCount={data.pageCount} total={data.total} params={params} />
          </div>
        ) : null}
      </PanelCard>

      <PanelCard title={`Balances · ${balances.year}`}>
        {balances.rows.length === 0 ? (
          <EmptyState size="sm">No one to show.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-xs" aria-label="Leave balances">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className="py-2 pr-3">Employee</th>
                  <th scope="col" className="py-2 pr-3 text-right">Allowance</th>
                  <th scope="col" className="py-2 pr-3 text-right">Taken</th>
                  <th scope="col" className="py-2 pr-3 text-right">Pending</th>
                  <th scope="col" className="py-2 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {balances.rows.map((b) => (
                  <tr key={b.id} className="border-b border-zinc-100 last:border-b-0">
                    <td className="py-2 pr-3">
                      <span className="font-bold">{b.name}</span>
                      <span className="block text-[11px] text-zinc-500">{ROLE_LABELS[b.role]}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {b.allowance}
                      {b.provisional ? <span className="block text-[10px] text-amber-800">prorated (provisional)</span> : b.prorated ? <span className="block text-[10px] text-zinc-500">prorated</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{b.granted}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{b.pending}</td>
                    <td className="py-2 text-right font-bold tabular-nums">{b.remaining}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-zinc-500">Requests across two calendar years are held and not counted until the company confirms how they are deducted.</p>
      </PanelCard>

      {canManageLeaveSettings(actor) ? (
        <PanelCard title="Leave settings">
          <LeaveSettingsForm annualDays={settings.annualDays} staffStep1={settings.staffStep1} staffStep2={settings.staffStep2} prorationMethod={settings.prorationMethod} />
        </PanelCard>
      ) : null}
    </PageStack>
  );
}
