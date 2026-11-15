import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import {
  attendanceRecords,
  bookingPayments,
  bookings,
  cities,
  clients,
  dailyReports,
  employeeProfiles,
  holidays,
  leadImportBatches,
  leads,
  meetings,
  projects,
  tasks,
  teams,
  units,
  users,
} from "@/server/db/schema";

/**
 * Names for the records audit entries point at (owner review, 16 Nov 2026): "Ahmed Ali (RHFQ…)" and
 * a link to its page instead of a bare id. One query per record type on the page, never per row.
 * A record that no longer exists gets no name; the page then shows its id.
 */
export type RecordRef = { name: string; href: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (entity: string, id: string) => `${entity}:${id}`;

const EXPORT_NAMES: Record<string, string> = {
  employees: "Employees list",
  leave: "Leave requests",
  "leave-balances": "Leave balances",
  "attendance-month": "Attendance, month",
  "attendance-day": "Attendance, one day",
  "attendance-person": "Attendance, one person",
};

export async function recordNames(db: Database, rows: { entity: string; entityId: string | null }[]) {
  const out = new Map<string, RecordRef>();
  const ids = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.entityId) continue;
    // Text ids: say what they are without a lookup.
    if (r.entity === "export") out.set(key(r.entity, r.entityId), { name: EXPORT_NAMES[r.entityId] ?? r.entityId, href: null });
    else if (r.entity === "app_setting" || r.entity === "app_settings") out.set(key(r.entity, r.entityId), { name: r.entityId.replace(/[._]+/g, " "), href: null });
    else if (UUID.test(r.entityId)) {
      if (!ids.has(r.entity)) ids.set(r.entity, []);
      if (!ids.get(r.entity)!.includes(r.entityId)) ids.get(r.entity)!.push(r.entityId);
    }
  }
  const set = (entity: string, id: string, name: string | null | undefined, href: string | null) => {
    if (name) out.set(key(entity, id), { name, href });
  };
  const of = (entity: string) => ids.get(entity) ?? [];
  // One query at a time, like the rest of the audit log (one connection is enough).
  const jobs: (() => Promise<void>)[] = [];
  const run = (entity: string, fn: (list: string[]) => Promise<void>) => {
    if (of(entity).length) jobs.push(() => fn(of(entity)));
  };

  run("lead", async (list) => {
    for (const r of await db.select({ id: leads.id, name: leads.name, code: leads.code }).from(leads).where(inArray(leads.id, list)))
      set("lead", r.id, `${r.name} (${r.code})`, `/dashboard/leads/${r.id}`);
  });
  run("client", async (list) => {
    for (const r of await db.select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, list))) set("client", r.id, r.name, `/dashboard/clients/${r.id}`);
  });
  run("booking", async (list) => {
    const rows = await db
      .select({ id: bookings.id, lead: leads.name, unit: units.unitNo })
      .from(bookings)
      .innerJoin(leads, eq(leads.id, bookings.leadId))
      .innerJoin(units, eq(units.id, bookings.unitId))
      .where(inArray(bookings.id, list));
    for (const r of rows) set("booking", r.id, `${r.lead} · unit ${r.unit}`, `/dashboard/bookings/${r.id}`);
  });
  run("payment", async (list) => {
    const rows = await db
      .select({ id: bookingPayments.id, kind: bookingPayments.kind, amount: bookingPayments.amount, lead: leads.name })
      .from(bookingPayments)
      .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
      .innerJoin(leads, eq(leads.id, bookings.leadId))
      .where(inArray(bookingPayments.id, list));
    for (const r of rows) set("payment", r.id, `${r.kind === "payment" ? "Payment" : "Reversal"} PKR ${Math.round(r.amount).toLocaleString("en-US")} · ${r.lead}`, `/dashboard/finance/payments/${r.id}`);
  });
  run("unit", async (list) => {
    const rows = await db.select({ id: units.id, unit: units.unitNo, project: projects.name }).from(units).innerJoin(projects, eq(projects.id, units.projectId)).where(inArray(units.id, list));
    for (const r of rows) set("unit", r.id, `${r.unit} · ${r.project}`, `/dashboard/inventory/${r.id}`);
  });
  run("project", async (list) => {
    for (const r of await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, list))) set("project", r.id, r.name, `/dashboard/projects/${r.id}`);
  });
  run("task", async (list) => {
    for (const r of await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, list))) set("task", r.id, r.title, `/dashboard/tasks/${r.id}`);
  });
  run("meeting", async (list) => {
    for (const r of await db.select({ id: meetings.id, title: meetings.title }).from(meetings).where(inArray(meetings.id, list))) set("meeting", r.id, r.title, `/dashboard/meetings/${r.id}`);
  });
  run("team", async (list) => {
    for (const r of await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, list))) set("team", r.id, r.name, "/dashboard/teams");
  });
  run("user", async (list) => {
    for (const r of await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, list))) set("user", r.id, r.name, `/dashboard/hr/employees/${r.id}`);
  });
  run("employee_profile", async (list) => {
    const account = alias(users, "profile_account");
    const rows = await db
      .select({ id: employeeProfiles.id, userName: account.name, fullName: employeeProfiles.fullName })
      .from(employeeProfiles)
      .leftJoin(account, eq(account.id, employeeProfiles.userId))
      .where(inArray(employeeProfiles.id, list));
    for (const r of rows) set("employee_profile", r.id, r.userName ?? r.fullName, null);
  });
  run("attendance_record", async (list) => {
    const rows = await db
      .select({ id: attendanceRecords.id, userId: attendanceRecords.userId, date: attendanceRecords.date, name: users.name })
      .from(attendanceRecords)
      .innerJoin(users, eq(users.id, attendanceRecords.userId))
      .where(inArray(attendanceRecords.id, list));
    for (const r of rows) set("attendance_record", r.id, `${r.name} · ${r.date}`, `/dashboard/hr/attendance/${r.userId}`);
  });
  run("daily_report", async (list) => {
    const rows = await db.select({ id: dailyReports.id, date: dailyReports.reportDate, team: teams.name }).from(dailyReports).innerJoin(teams, eq(teams.id, dailyReports.teamId)).where(inArray(dailyReports.id, list));
    for (const r of rows) set("daily_report", r.id, `${r.team} · ${r.date}`, null);
  });
  run("holiday", async (list) => {
    for (const r of await db.select({ id: holidays.id, name: holidays.name, date: holidays.date }).from(holidays).where(inArray(holidays.id, list)))
      set("holiday", r.id, `${r.name} · ${r.date}`, "/dashboard/hr/holidays");
  });
  run("city", async (list) => {
    for (const r of await db.select({ id: cities.id, name: cities.name }).from(cities).where(inArray(cities.id, list))) set("city", r.id, r.name, "/dashboard/settings/cities");
  });
  run("lead_import_batch", async (list) => {
    for (const r of await db.select({ id: leadImportBatches.id, file: leadImportBatches.fileName }).from(leadImportBatches).where(inArray(leadImportBatches.id, list)))
      set("lead_import_batch", r.id, r.file ?? "Lead import", `/dashboard/leads/import/${r.id}`);
  });

  for (const job of jobs) await job();
  return { get: (entity: string, id: string | null) => (id ? (out.get(key(entity, id)) ?? null) : null) };
}
