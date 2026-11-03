import { Plane } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { HrTabs } from "@/features/hr/components/hr-tabs";
import { formatListedOn } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { CancelApprovedLeave, LeaveDecision, LeaveSettingsForm } from "@/features/leave/components/leave-admin";
import { LeaveStatusTag } from "@/features/leave/components/leave-status";
import { canViewEmployees } from "@/modules/employees/policy";
import { canViewHolidays } from "@/modules/holidays/policy";
import { CROSS_YEAR_HELD_NOTE, isCrossYear, LEAVE_TYPE_LABELS, STAFF_STEP_LABELS } from "@/modules/leave/rules";
import { canCancelApprovedLeave, canManageLeaveSettings, canOpenLeaveAdmin, leaveOverview, type LeaveRow } from "@/modules/leave/service";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Leave" };

const when = (r: LeaveRow) => `${formatListedOn(r.startDate)}${r.endDate !== r.startDate ? ` – ${formatListedOn(r.endDate)}` : ""} · ${r.days} day${r.days === 1 ? "" : "s"}`;

/** HR → Leave (FR-142): approvals waiting for you, cancellation requests, all requests and settings. */
export default async function LeavePage() {
  const actor = await requirePageUser();
  if (!canOpenLeaveAdmin(actor)) return <RestrictedState />;
  const data = await leaveOverview(getDb(), actor);
  const { settings } = data;
  const stepNote = (r: LeaveRow) =>
    r.approvalPath === "senior"
      ? "Super Admin approval"
      : `Step ${r.currentStep} of 2 · ${(r.currentStep === 1 ? settings.staffStep1 : settings.staffStep2) ? STAFF_STEP_LABELS[(r.currentStep === 1 ? settings.staffStep1 : settings.staffStep2)!] : "approver not set"}`;

  return (
    <PageStack>
      <PageHeader title="Leave" description={`Leave requests for ${data.year}. Days are calendar days.`} icon={Plane} />
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

      <PanelCard title={`All requests · ${data.rows.length}`}>
        {data.rows.length === 0 ? (
          <EmptyState size="sm">No leave requests in {data.year}.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className="py-2 pr-3">Employee</th>
                  <th scope="col" className="py-2 pr-3">Type</th>
                  <th scope="col" className="py-2 pr-3">Dates</th>
                  <th scope="col" className="py-2 pr-3">Status</th>
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
                    <td className="py-2">{canCancelApprovedLeave(actor) && r.status === "approved" && r.userId !== actor.id ? <CancelApprovedLeave id={r.id} name={r.userName} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>

      {canManageLeaveSettings(actor) ? (
        <PanelCard title="Leave settings">
          <LeaveSettingsForm annualDays={settings.annualDays} staffStep1={settings.staffStep1} staffStep2={settings.staffStep2} prorationMethod={settings.prorationMethod} />
        </PanelCard>
      ) : null}
    </PageStack>
  );
}
