import { Plane } from "lucide-react";
import { CsvDownload } from "@/features/hr/components/csv-download";
import { canDownloadHr } from "@/modules/hr/exports";
import type { Metadata } from "next";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { HrTabs } from "@/features/hr/components/hr-tabs";
import { canViewAttendance } from "@/modules/attendance/service";
import { formatListedOn } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { CancelApprovedLeave, LeaveDecision, LeaveSettingsForm } from "@/features/leave/components/leave-admin";
import { LeaveListFilters, LeaveSortHeader } from "@/features/leave/components/leave-list-controls";
import { LeaveStatusTag } from "@/features/leave/components/leave-status";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams } from "@/features/leads/url";
import { canViewEmployees } from "@/modules/employees/policy";
import { canViewHolidays } from "@/modules/holidays/policy";
import { CROSS_YEAR_HELD_NOTE, isCrossYear, LEAVE_TYPE_LABELS, LEAVE_TYPES, STAFF_STEP_LABELS } from "@/modules/leave/rules";
import { businessToday } from "@/modules/bookings/today";
import { canCancelApprovedLeave, canManageLeaveSettings, canOpenLeaveAdmin, canRecordLeave, leaveBalances, leaveOverview, leavePeople, type LeaveRow } from "@/modules/leave/service";
import { RecordLeaveForm } from "@/features/leave/components/record-leave-form";
import { CardFilter } from "@/features/leave/components/card-filter";
import { BALANCE_SHOWS, filterBalances, filterRequests } from "@/modules/leave/card-filters";
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
  const [data, balances, people] = await Promise.all([leaveOverview(db, actor, year, params), leaveBalances(db, actor, year), leavePeople(db, actor)]);
  // Each card filters on its own (15 Nov 2026).
  const decidable = filterRequests(data.decidable, params.dq, params.dtype);
  const cancellations = filterRequests(data.cancellations, params.cq, params.ctype);
  const balanceRows = filterBalances(balances.rows, params);
  const typeSelect = (name: string) => ({ name, label: "Leave type", all: "All types", options: LEAVE_TYPES.map((t) => ({ value: t, label: LEAVE_TYPE_LABELS[t] })) });
  const roles = [...new Set(balances.rows.map((r) => r.role).filter((r): r is NonNullable<typeof r> => Boolean(r)))];
  const sortHeader = (column: Parameters<typeof LeaveSortHeader>[0]["column"], label: string) => (
    <th scope="col" className="py-2 pr-3" aria-sort={data.query.sort === column ? (data.query.dir === "asc" ? "ascending" : "descending") : undefined}>
      <LeaveSortHeader path={PATH} params={params} column={column} label={label} sort={data.query.sort} dir={data.query.dir} />
    </th>
  );
  const { settings } = data;
  const stepNote = (r: LeaveRow) =>
    r.approvalPath === "senior"
      ? "Super Admin approval"
      : settings.staffStep2 === "none"
        ? STAFF_STEP_LABELS[settings.staffStep1]
        : `Step ${r.currentStep} of 2 · ${STAFF_STEP_LABELS[r.currentStep === 1 ? settings.staffStep1 : settings.staffStep2]}`;

  return (
    <PageStack>
      <PageHeader title="Leave" description={`Leave requests and balances for ${data.year}. Days are calendar days.`} icon={Plane} />
      <HrTabs showAttendance={canViewAttendance(actor)} active="leave" showEmployees={canViewEmployees(actor)} showHolidays={canViewHolidays(actor)} showLeave />

      <PanelCard title={`Waiting for your decision · ${decidable.length}${decidable.length !== data.decidable.length ? ` of ${data.decidable.length}` : ""}`}>
        {data.decidable.length ? (
          <CardFilter path={PATH} params={params} label="Filter requests waiting for your decision" search={{ name: "dq", placeholder: "Employee or reason" }} selects={[typeSelect("dtype")]} />
        ) : null}
        {decidable.length === 0 ? (
          <EmptyState size="sm">{data.decidable.length ? "No requests match these filters." : "Nothing waiting for you."}</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100" aria-label="Leave waiting for your decision">
            {decidable.map((r) => (
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
        <PanelCard title={`Cancellation requests · ${cancellations.length}${cancellations.length !== data.cancellations.length ? ` of ${data.cancellations.length}` : ""}`}>
          {data.cancellations.length ? (
            <CardFilter path={PATH} params={params} label="Filter cancellation requests" search={{ name: "cq", placeholder: "Employee or reason" }} selects={[typeSelect("ctype")]} />
          ) : null}
          {cancellations.length === 0 ? (
            <EmptyState size="sm">{data.cancellations.length ? "No requests match these filters." : "No cancellation requests."}</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {cancellations.map((r) => (
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

      {canRecordLeave(actor) ? (
        <PanelCard title="Record leave for someone">
          <RecordLeaveForm
            people={people}
            approvesNow={
              actor.role === "super_admin"
                ? "Leave you record is approved at once."
                : actor.role === "admin"
                  ? settings.hrPath === "staff"
                    ? "Leave you record for agents, accountants, HR and staff without a login is approved at once; for Admins it goes to a Super Admin."
                    : "Leave you record for agents, accountants and staff without a login is approved at once; for HR and Admins it goes to a Super Admin."
                  : "Leave you record goes through the normal approvals."
            }
          />
        </PanelCard>
      ) : null}

      <PanelCard title={`All requests · ${data.year} · ${data.total}`}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <LeaveListFilters path={PATH} params={params} years={data.years} year={data.year} />
          {canDownloadHr(actor) ? <CsvDownload kind="leave" params={{ ...params, year: String(data.year) }} /> : null}
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
                      <span className="block text-[11px] text-zinc-500">
                        {r.userRole ? ROLE_LABELS[r.userRole as Role] : "No CRM login"}
                        {r.recordedById ? " · recorded by HR / Admin" : ""}
                      </span>
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

      <PanelCard title={`Balances · ${balances.year}${balanceRows.length !== balances.rows.length ? ` · ${balanceRows.length} of ${balances.rows.length}` : ""}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <CardFilter
            path={PATH}
            params={params}
            label="Filter leave balances"
            search={{ name: "bq", placeholder: "Employee name" }}
            selects={[
              { name: "brole", label: "Role", all: "All roles", options: [...roles.map((r) => ({ value: r, label: ROLE_LABELS[r as Role] ?? r })), { value: "none", label: "No CRM login" }] },
              { name: "bshow", label: "Show", all: "Everyone", options: Object.entries(BALANCE_SHOWS).map(([value, label]) => ({ value, label })) },
            ]}
          />
          {canDownloadHr(actor) ? (
            <div className="mb-3">
              <CsvDownload kind="leave-balances" params={{ year: String(balances.year), bq: params.bq, brole: params.brole, bshow: params.bshow }} />
            </div>
          ) : null}
        </div>
        {balanceRows.length === 0 ? (
          <EmptyState size="sm">{balances.rows.length ? "No one matches these filters." : "No one to show."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs" aria-label="Leave balances">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className="py-2 pr-3">Employee</th>
                  <th scope="col" className="py-2 pr-3 text-right">Allowance</th>
                  <th scope="col" className="py-2 pr-3 text-right">Taken</th>
                  <th scope="col" className="py-2 pr-3 text-right">of which medical</th>
                  <th scope="col" className="py-2 pr-3 text-right">Pending</th>
                  <th scope="col" className="py-2 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {balanceRows.map((b) => (
                  <tr key={b.id} className="border-b border-zinc-100 last:border-b-0">
                    <td className="py-2 pr-3">
                      <span className="font-bold">{b.name}</span>
                      <span className="block text-[11px] text-zinc-500">{b.role ? ROLE_LABELS[b.role as Role] : "No CRM login"}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {b.allowance}
                      {b.provisional ? <span className="block text-[10px] text-amber-800">prorated (provisional)</span> : b.prorated ? <span className="block text-[10px] text-zinc-500">prorated</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{b.granted}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-zinc-600">{b.medical}</td>
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
          <LeaveSettingsForm annualDays={settings.annualDays} staffStep1={settings.staffStep1} staffStep2={settings.staffStep2} hrPath={settings.hrPath} prorationMethod={settings.prorationMethod} />
        </PanelCard>
      ) : null}
    </PageStack>
  );
}
