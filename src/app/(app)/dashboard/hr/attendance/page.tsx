import { Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { AttendanceSettingsForm, CorrectDay } from "@/features/attendance/components/attendance-admin";
import { STATUS_TONES } from "@/features/attendance/components/check-in-card";
import { HrTabs } from "@/features/hr/components/hr-tabs";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatListedOn } from "@/features/inventory/format";
import { flattenParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { ATTENDANCE_STATUS_LABELS, formatMinutes, WEEKDAY_LABELS } from "@/modules/attendance/rules";
import { canManageAttendance, canViewAttendance, dailySheet, getAttendanceSettings, monthlySummary } from "@/modules/attendance/service";
import { addDays, businessToday } from "@/modules/bookings/today";
import { canViewEmployees } from "@/modules/employees/policy";
import { canViewHolidays } from "@/modules/holidays/policy";
import { canOpenLeaveAdmin } from "@/modules/leave/service";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Attendance" };

const PATH = "/dashboard/hr/attendance";
const th = "px-3 py-3";
const td = "px-3 py-2.5 whitespace-nowrap";

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}
function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** HR → Attendance (owner, 15 Nov 2026): the daily check-in sheet, a monthly summary and office hours. */
export default async function AttendancePage({ searchParams }: PageProps<"/dashboard/hr/attendance">) {
  const actor = await requirePageUser();
  if (!canViewAttendance(actor)) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const today = businessToday();
  const view = params.view === "month" ? "month" : "day";
  const db = getDb();
  const settings = await getAttendanceSettings(db);
  const tabs = (
    <div role="group" aria-label="View" className="inline-flex rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-1 shadow-hairline">
      {[
        { key: "day", label: "Daily sheet", href: PATH },
        { key: "month", label: "Monthly summary", href: `${PATH}?view=month` },
      ].map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={view === t.key ? "true" : undefined}
          className={cn("rounded-lg px-3 py-1.5 text-xs font-bold transition-colors", view === t.key ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-white")}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (view === "day") {
    const sheet = await dailySheet(db, actor, params.date ?? today, today);
    const canCorrect = canManageAttendance(actor) && sheet.date <= today;
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`${PATH}?date=${addDays(sheet.date, -1)}`} className={buttonClasses({ variant: "secondary", size: "md" })}>
            ← Previous day
          </Link>
          <form method="get" action={PATH} className="flex items-center gap-2">
            <input type="date" name="date" defaultValue={sheet.date} max={today} aria-label="Day" className="h-9 rounded-lg border border-zinc-200/80 bg-white px-2 text-xs font-semibold" />
            <button type="submit" className={buttonClasses({ variant: "secondary", size: "md" })}>
              Show
            </button>
          </form>
          {sheet.date < today ? (
            <Link href={`${PATH}?date=${addDays(sheet.date, 1)}`} className={buttonClasses({ variant: "secondary", size: "md" })}>
              Next day →
            </Link>
          ) : null}
          <p className="text-xs font-bold text-zinc-700">
            {WEEKDAY_LABELS[new Date(`${sheet.date}T00:00:00Z`).getUTCDay()]}, {formatListedOn(sheet.date)}
            {sheet.date === today ? " · Today" : ""}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <MiniStat label="Present" value={String(sheet.counts.present + sheet.counts.late)} caption={`${sheet.counts.late} late`} />
          <MiniStat label="Late" value={String(sheet.counts.late)} caption={`After ${settings.lateAfter}`} />
          <MiniStat label={sheet.date === today ? "Not checked in" : "Absent"} value={String(sheet.date === today ? sheet.counts.not_yet : sheet.counts.absent)} caption="Working day, no check-in" />
          <MiniStat label="On leave" value={String(sheet.counts.on_leave)} caption="Approved leave" />
          <MiniStat label="Holiday" value={String(sheet.counts.holiday)} caption="Company holiday" />
          <MiniStat label="Day off" value={String(sheet.counts.weekend)} caption="Weekly day off" />
        </div>
        <PanelCard title={`Daily sheet · ${sheet.rows.length} people`}>
          <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <thead className="bg-zinc-100">
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className={th}>Person</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}>Check in</th>
                  <th scope="col" className={th}>Check out</th>
                  <th scope="col" className={th}>Hours</th>
                  {canCorrect ? <th scope="col" className={th}><span className="sr-only">Correct</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r) => (
                  <tr key={r.userId} className="border-b border-zinc-100/80 align-top last:border-b-0 hover:bg-zinc-50/60">
                    <td className={td}>
                      <p className="font-bold">{r.name}</p>
                      <p className="text-[11px] text-zinc-500">{ROLE_LABELS[r.role as Role] ?? r.role}</p>
                    </td>
                    <td className={td}>
                      <StatusTag tone={STATUS_TONES[r.status]}>{ATTENDANCE_STATUS_LABELS[r.status]}</StatusTag>
                      {r.corrected ? (
                        <p className="mt-1 max-w-48 truncate text-[10px] text-zinc-500" title={r.correctionNote ?? undefined}>
                          Corrected{r.correctedBy ? ` by ${r.correctedBy}` : ""}{r.correctionNote ? `: ${r.correctionNote}` : ""}
                        </p>
                      ) : null}
                    </td>
                    <td className={cn(td, "tabular-nums")}>{r.checkIn ?? "—"}</td>
                    <td className={cn(td, "tabular-nums")}>{r.checkOut ?? (r.checkIn && sheet.date < today ? <span className="text-amber-700">Missing</span> : "—")}</td>
                    <td className={cn(td, "tabular-nums")}>{formatMinutes(r.minutes)}</td>
                    {canCorrect ? (
                      <td className={td}>{r.userId === actor.id ? null : <CorrectDay key={`${r.userId}-${sheet.date}`} userId={r.userId} name={r.name} date={sheet.date} checkIn={r.checkIn} checkOut={r.checkOut} />}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelCard>
      </>
    );
  } else {
    const summary = await monthlySummary(db, actor, params.month ?? today.slice(0, 7), today);
    const thisMonth = today.slice(0, 7);
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`${PATH}?view=month&month=${shiftMonth(summary.month, -1)}`} className={buttonClasses({ variant: "secondary", size: "md" })}>
            ← Previous month
          </Link>
          {summary.month < thisMonth ? (
            <Link href={`${PATH}?view=month&month=${shiftMonth(summary.month, 1)}`} className={buttonClasses({ variant: "secondary", size: "md" })}>
              Next month →
            </Link>
          ) : null}
          <p className="text-xs font-bold text-zinc-700">
            {monthLabel(summary.month)}
            {summary.month === thisMonth ? " · up to today" : ""}
          </p>
        </div>
        <PanelCard title={`Monthly summary · ${monthLabel(summary.month)}`}>
          <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <thead className="bg-zinc-100">
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className={th}>Person</th>
                  <th scope="col" className={th}>Working days</th>
                  <th scope="col" className={th}>Present</th>
                  <th scope="col" className={th}>Late</th>
                  <th scope="col" className={th}>Absent</th>
                  <th scope="col" className={th}>On leave</th>
                  <th scope="col" className={th}>Holidays</th>
                  <th scope="col" className={th}>Hours worked</th>
                  <th scope="col" className={th}>Missing check-outs</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.userId} className="border-b border-zinc-100/80 last:border-b-0 hover:bg-zinc-50/60">
                    <td className={td}>
                      <p className="font-bold">{r.name}</p>
                      <p className="text-[11px] text-zinc-500">{ROLE_LABELS[r.role as Role] ?? r.role}</p>
                    </td>
                    <td className={cn(td, "tabular-nums")}>{r.workingDays}</td>
                    <td className={cn(td, "tabular-nums font-bold")}>{r.present + r.late}</td>
                    <td className={cn(td, "tabular-nums", r.late ? "text-amber-700" : "")}>{r.late}</td>
                    <td className={cn(td, "tabular-nums", r.absent ? "font-bold text-rose-700" : "")}>{r.absent}</td>
                    <td className={cn(td, "tabular-nums")}>{r.onLeave}</td>
                    <td className={cn(td, "tabular-nums")}>{r.holiday}</td>
                    <td className={cn(td, "tabular-nums")}>{formatMinutes(r.minutes)}</td>
                    <td className={cn(td, "tabular-nums", r.missingCheckOut ? "text-amber-700" : "")}>{r.missingCheckOut}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-zinc-500">Working days exclude weekly days off and company holidays. Present includes late check-ins. Days with no check-out count no hours.</p>
        </PanelCard>
      </>
    );
  }

  return (
    <PageStack>
      <PageHeader title="Attendance" description={`Office hours ${settings.officeStart}–${settings.officeEnd} · late after ${settings.lateAfter}. Everyone checks in and out from My Workplace.`} icon={Clock} />
      <HrTabs showAttendance active="attendance" showEmployees={canViewEmployees(actor)} showHolidays={canViewHolidays(actor)} showLeave={canOpenLeaveAdmin(actor)} />
      <div>{tabs}</div>
      {body}
      {canManageAttendance(actor) ? (
        <PanelCard title="Office hours and days off">
          <AttendanceSettingsForm officeStart={settings.officeStart} lateAfter={settings.lateAfter} officeEnd={settings.officeEnd} weekendDays={settings.weekendDays} />
        </PanelCard>
      ) : null}
    </PageStack>
  );
}
