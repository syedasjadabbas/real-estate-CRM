import { ArrowLeft, CalendarClock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { STATUS_TONES } from "@/features/attendance/components/check-in-card";
import { CsvDownload } from "@/features/hr/components/csv-download";
import { HrTabs } from "@/features/hr/components/hr-tabs";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { flattenParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { ATTENDANCE_STATUS_LABELS, formatMinutes, monthLabel, shiftMonth, WEEKDAY_LABELS } from "@/modules/attendance/rules";
import { canViewAttendance, personAttendance, type PersonAttendance } from "@/modules/attendance/service";
import { canViewEmployees } from "@/modules/employees/policy";
import { canViewHolidays } from "@/modules/holidays/policy";
import { canDownloadHr } from "@/modules/hr/exports";
import { canOpenLeaveAdmin } from "@/modules/leave/service";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Attendance history" };

const th = "px-3 py-2.5";
const td = "px-3 py-2 whitespace-nowrap";

/** One person's attendance, day by day, for a month (owner, 15 Nov 2026). HR, Admins and Super Admins. */
export default async function PersonAttendancePage({ params, searchParams }: PageProps<"/dashboard/hr/attendance/[id]">) {
  const actor = await requirePageUser();
  if (!canViewAttendance(actor)) return <RestrictedState />;
  const { id } = await params;
  const q = flattenParams(await searchParams);
  let v: PersonAttendance;
  try {
    v = await personAttendance(getDb(), actor, id, q.month ?? "");
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const base = `/dashboard/hr/attendance/${v.person.id}`;
  const thisMonth = v.today.slice(0, 7);
  const t = v.totals;
  const shown = v.days.filter((d) => d.date <= v.today);

  return (
    <PageStack>
      <PageHeader
        title={`${v.person.name} · attendance`}
        icon={CalendarClock}
        description={`${ROLE_LABELS[v.person.role as Role] ?? v.person.role}${v.person.status === "active" ? "" : " · inactive account"} · office hours ${v.settings.officeStart}–${v.settings.officeEnd}, late after ${v.settings.lateAfter}`}
        actions={
          <Link href={`/dashboard/hr/attendance?view=month&month=${v.month}`} className={buttonClasses({ variant: "secondary", size: "md" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Everyone this month
          </Link>
        }
      />
      <HrTabs showAttendance active="attendance" showEmployees={canViewEmployees(actor)} showHolidays={canViewHolidays(actor)} showLeave={canOpenLeaveAdmin(actor)} />

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`${base}?month=${shiftMonth(v.month, -1)}`} className={buttonClasses({ variant: "secondary", size: "md" })}>
          ← Previous month
        </Link>
        {v.month < thisMonth ? (
          <Link href={`${base}?month=${shiftMonth(v.month, 1)}`} className={buttonClasses({ variant: "secondary", size: "md" })}>
            Next month →
          </Link>
        ) : null}
        <p className="text-xs font-bold text-zinc-700">
          {monthLabel(v.month)}
          {v.month === thisMonth ? " · up to today" : ""}
        </p>
        {canDownloadHr(actor) ? <CsvDownload kind="attendance-person" params={{ user: v.person.id, month: v.month }} label="Download this month (CSV)" /> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <MiniStat label="Working days" value={String(t.workingDays)} caption="So far, excluding days off" />
        <MiniStat label="Present" value={String(t.present + t.late)} caption="Including late" />
        <MiniStat label="Late" value={String(t.late)} caption={`After ${v.settings.lateAfter}`} />
        <MiniStat label="Absent" value={String(t.absent)} caption="Working day, no check-in" />
        <MiniStat label="On leave" value={String(t.onLeave)} caption="Approved leave" />
        <MiniStat label="Hours worked" value={formatMinutes(t.minutes)} caption="Days with a check-out" />
        <MiniStat label="Missing check-outs" value={String(t.missingCheckOut)} caption="Earlier days" />
      </div>

      <PanelCard title={`Day by day · ${monthLabel(v.month)}`}>
        {shown.length === 0 ? (
          <p className="text-xs text-zinc-500">This month hasn&apos;t started yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <thead className="bg-zinc-100">
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className={th}>Date</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}>Check in</th>
                  <th scope="col" className={th}>Check out</th>
                  <th scope="col" className={th}>Hours</th>
                  <th scope="col" className={th}>Correction</th>
                </tr>
              </thead>
              <tbody>
                {[...shown].reverse().map((d) => (
                  <tr key={d.date} className={cn("border-b border-zinc-100/80 last:border-b-0", (d.status === "weekend" || d.status === "holiday" || d.status === "not_tracked") && "bg-zinc-50/70 text-zinc-500")}>
                    <td className={cn(td, "font-semibold")}>
                      <Link href={`/dashboard/hr/attendance?date=${d.date}`} className="hover:text-brand hover:underline">
                        {WEEKDAY_LABELS[new Date(`${d.date}T00:00:00Z`).getUTCDay()].slice(0, 3)}, {d.date.slice(8)} {monthLabel(v.month).split(" ")[0].slice(0, 3)}
                      </Link>
                      {d.date === v.today ? <span className="ml-1.5 text-[10px] font-bold text-brand">Today</span> : null}
                    </td>
                    <td className={td}>
                      <StatusTag tone={STATUS_TONES[d.status]}>{ATTENDANCE_STATUS_LABELS[d.status]}</StatusTag>
                    </td>
                    <td className={cn(td, "tabular-nums")}>{d.checkIn ?? "—"}</td>
                    <td className={cn(td, "tabular-nums")}>{d.checkOut ?? (d.checkIn && d.date < v.today ? <span className="text-amber-700">Missing</span> : "—")}</td>
                    <td className={cn(td, "tabular-nums")}>{formatMinutes(d.minutes)}</td>
                    <td className="max-w-64 px-3 py-2 text-[11px] break-words text-zinc-600">
                      {d.correctedBy || d.correctionNote ? `${d.correctedBy ? `By ${d.correctedBy}` : "Corrected"}${d.correctionNote ? `: ${d.correctionNote}` : ""}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-zinc-500">Newest first. Click a date to open everyone&apos;s sheet for that day, where HR can correct a missed check-in or check-out.</p>
      </PanelCard>
    </PageStack>
  );
}
