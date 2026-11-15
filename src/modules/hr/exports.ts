import { z } from "zod";
import { ATTENDANCE_STATUS_LABELS, formatMinutes } from "@/modules/attendance/rules";
import { dailySheet, monthlySummary, personAttendance } from "@/modules/attendance/service";
import { businessToday } from "@/modules/bookings/today";
import { listEmployees } from "@/modules/employees/service";
import { LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS } from "@/modules/leave/rules";
import { leaveBalances, leaveDecisionHistory, leaveOverview } from "@/modules/leave/service";
import { ROLE_LABELS, type Actor, type Role } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { auditLogs } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import { toCsv, type CsvValue } from "@/server/csv";

/**
 * CSV downloads for HR (owner, 15 Nov 2026): employees, leave requests, leave balances, and the
 * attendance monthly summary and daily sheet. HR, Admins and Super Admins only. Each file holds the
 * same rows as the page with the same filters, and every download is written to the audit log.
 */
export const HR_EXPORTS = ["employees", "leave", "leave-balances", "attendance-month", "attendance-day", "attendance-person"] as const;
export type HrExport = (typeof HR_EXPORTS)[number];

export const canDownloadHr = (actor: Pick<Actor, "role">) => actor.role === "hr" || actor.role === "admin" || actor.role === "super_admin";

const role = (r: string | null | undefined) => (r ? (ROLE_LABELS[r as Role] ?? r) : "No CRM login");
const kindSchema = z.enum(HR_EXPORTS);

export async function hrExport(db: Database, actor: Actor, rawKind: unknown, query: Record<string, string>) {
  if (!canDownloadHr(actor)) throw forbidden();
  const parsed = kindSchema.safeParse(rawKind);
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", "Choose what to download.");
  const kind = parsed.data;
  const today = businessToday();
  let header: string[];
  let rows: CsvValue[][];
  let filename: string;

  if (kind === "employees") {
    const list = await listEmployees(db, actor, query, { all: true });
    header = ["Name", "Email", "Role", "Designation", "Department", "Phone", "Joining date", "Account"];
    rows = list.rows.map((r) => [r.name, r.email, role(r.role), r.designation, r.department, r.phone, r.joiningDate, r.status === "active" ? "Active" : "Inactive"]);
    filename = `employees-${today}.csv`;
  } else if (kind === "leave" || kind === "leave-balances") {
    const thisYear = Number(today.slice(0, 4));
    const asked = Number(query.year);
    const year = Number.isInteger(asked) && asked >= 2000 && asked <= thisYear + 1 ? asked : thisYear;
    if (kind === "leave") {
      const data = await leaveOverview(db, actor, year, query, { all: true });
      const history = await leaveDecisionHistory(db, data.rows.map((r) => r.id));
      header = ["Employee", "Role", "Type", "First day", "Last day", "Days", "Status", "Reason", "Requested on", "Decisions"];
      rows = data.rows.map((r) => [
        r.userName,
        role(r.userRole),
        LEAVE_TYPE_LABELS[r.type],
        r.startDate,
        r.endDate,
        r.days,
        LEAVE_STATUS_LABELS[r.status],
        r.reason,
        r.createdAt.toISOString().slice(0, 10),
        history
          .filter((h) => h.requestId === r.id)
          .map((h) => `${h.approved ? "Approved" : "Rejected"}${h.kind === "approval" && h.step ? ` (step ${h.step})` : h.kind !== "approval" ? ` (${h.kind.replace(/_/g, " ")})` : ""} by ${h.actorName ?? "a former user"}`)
          .join("; "),
      ]);
      filename = `leave-requests-${year}.csv`;
    } else {
      const data = await leaveBalances(db, actor, year);
      header = ["Employee", "Role", "Year", "Allowance", "Taken", "Pending", "Remaining", "Medical taken"];
      rows = data.rows.map((r) => [r.name, role(r.role), r.year, r.allowance, r.granted, r.pending, r.remaining, r.medical]);
      filename = `leave-balances-${year}.csv`;
    }
  } else if (kind === "attendance-month") {
    const data = await monthlySummary(db, actor, query.month ?? today.slice(0, 7), today);
    header = ["Employee", "Role", "Month", "Working days", "Present (incl. late)", "Late", "Absent", "On leave", "Holidays", "Hours worked", "Missing check-outs"];
    rows = data.rows.map((r) => [r.name, role(r.role), data.month, r.workingDays, r.present + r.late, r.late, r.absent, r.onLeave, r.holiday, formatMinutes(r.minutes), r.missingCheckOut]);
    filename = `attendance-${data.month}.csv`;
  } else if (kind === "attendance-person") {
    const data = await personAttendance(db, actor, query.user ?? "", query.month ?? today.slice(0, 7), today);
    header = ["Employee", "Date", "Day", "Status", "Check in", "Check out", "Hours", "Corrected by", "Correction reason"];
    rows = data.days
      .filter((d) => d.date <= today)
      .map((d) => [data.person.name, d.date, new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${d.date}T00:00:00Z`)), ATTENDANCE_STATUS_LABELS[d.status], d.checkIn, d.checkOut, d.minutes === null ? null : formatMinutes(d.minutes), d.correctedBy, d.correctionNote]);
    filename = `attendance-${data.person.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${data.month}.csv`;
  } else {
    const data = await dailySheet(db, actor, query.date ?? today, today);
    header = ["Employee", "Role", "Date", "Status", "Check in", "Check out", "Hours", "Corrected by", "Correction reason"];
    rows = data.rows.map((r) => [r.name, role(r.role), data.date, ATTENDANCE_STATUS_LABELS[r.status], r.checkIn, r.checkOut, r.minutes === null ? null : formatMinutes(r.minutes), r.correctedBy, r.correctionNote]);
    filename = `attendance-${data.date}.csv`;
  }

  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "hr.export", entity: "export", entityId: kind, before: null, after: { filters: query, rows: rows.length, file: filename } });
  return { filename, body: toCsv(header, rows), rows: rows.length };
}
