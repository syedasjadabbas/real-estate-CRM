import { ATTENDANCE_STATUS_LABELS, formatMinutes } from "@/modules/attendance/rules";
import { STAGE_LABELS } from "@/modules/leads/constants";
import { ROLE_LABELS, type Actor, type Role } from "@/server/auth/types";
import { toCsv, type CsvValue } from "@/server/csv";
import type { Database } from "@/server/db";
import { auditLogs } from "@/server/db/schema";
import { employeeProfile } from "./profile";

/**
 * Download one employee's work record as CSV (owner, 15 Nov 2026): everything on the work profile
 * for the chosen dates, one row per figure (Section, Item, Value). Admins and Super Admins only;
 * every download is written to the audit log.
 */
export async function employeeProfileCsv(db: Database, actor: Actor, userId: string, query: Record<string, string>) {
  const p = await employeeProfile(db, actor, userId, query);
  const m = p.metrics;
  const rows: CsvValue[][] = [];
  const add = (section: string, item: string, value: CsvValue) => rows.push([section, item, value]);

  add("Employee", "Name", p.person.name);
  add("Employee", "Email", p.person.email);
  add("Employee", "Role", ROLE_LABELS[p.person.role as Role] ?? p.person.role);
  add("Employee", "Account", p.person.status === "active" ? "Active" : "Inactive");
  add("Employee", "Designation", p.profile?.designation ?? "");
  add("Employee", "Department", p.profile?.department ?? "");
  add("Employee", "Joining date", p.profile?.joiningDate ?? "");
  add("Employee", "Teams", p.teams.map((t) => `${t.name}${t.isLead ? " (Team Lead)" : ""}`).join("; "));
  add("Range", "From", p.range.from);
  add("Range", "To", p.range.to);

  add("Calls", "Calls (recordings)", m.calls);
  add("Calls", "Call minutes", m.callMin);
  add("Calls", "Timed calls", m.callsTimed);
  add("Calls", "Verified (30s+)", m.callsVerified);
  add("Calls", "Qualified (60s+)", m.callsQualified);

  for (const s of p.pipeline) add("Pipeline now", STAGE_LABELS[s.stage], s.count);
  add("Pipeline now", "Never touched (open)", p.untouched);

  add("Follow-ups", "Overdue now", p.followUps.overdue);
  add("Follow-ups", "Due later today", p.followUps.today);
  add("Follow-ups", "Upcoming", p.followUps.upcoming);
  add("Follow-ups", "Due in range", m.fuDue);
  add("Follow-ups", "Done in range", m.fuDone);
  add("Follow-ups", "Done %", m.fuPct);
  add("Follow-ups", "Done on time", p.followUps.doneOnTime);
  add("Follow-ups", "Done late", p.followUps.doneLate);

  add("Leads & bookings", "Leads assigned in range", m.leads);
  add("Leads & bookings", "Still open of those", m.open);
  add("Leads & bookings", "Won", m.booked);
  add("Leads & bookings", "Lost", m.lost);
  add("Leads & bookings", "Win rate %", m.winPct);
  add("Leads & bookings", "Avg time to first touch", m.avgFirstTouchMs === null ? "" : formatMinutes(Math.round(m.avgFirstTouchMs / 60_000)));
  add("Leads & bookings", "Meetings held", m.meetings);
  add("Leads & bookings", "Bookings made", p.bookings.made);
  add("Leads & bookings", "Bookings value (PKR)", p.bookings.value);
  add("Leads & bookings", "Closed won in range", p.bookings.won);
  add("Leads & bookings", "Open bookings now", p.bookings.open);
  add("Leads & bookings", "CRM sign-ins", m.signIns);

  add("Score", "Assignment score", p.score ? Math.round(p.score.score) : "");
  add("Score", "Provisional", p.score ? (p.score.provisional ? "Yes" : "No") : "");

  for (const [label, lines] of [["Today", p.targets.today], ["This week", p.targets.week], ["This month", p.targets.month]] as const) {
    for (const l of lines) if (l.target !== null) add(`Targets · ${label}`, l.label, `${l.actual} / ${l.target}${l.met ? " (met)" : ""}`);
  }

  add("Attendance", "Today", ATTENDANCE_STATUS_LABELS[p.attendance.status]);
  add("Attendance", "Working days this month", p.attendance.month.workingDays);
  add("Attendance", "Present (incl. late)", p.attendance.month.present + p.attendance.month.late);
  add("Attendance", "Late", p.attendance.month.late);
  add("Attendance", "Absent", p.attendance.month.absent);
  add("Attendance", "Hours worked", formatMinutes(p.attendance.month.minutes));
  add("Leave", `Remaining / allowance ${p.leave.year}`, `${p.leave.remaining} / ${p.leave.allowance}`);
  add("Leave", "Taken", p.leave.granted);
  add("Leave", "Pending", p.leave.pending);

  // Added 16 Nov 2026: everything else the page shows.
  add("Previous period", "Dates", `${p.previous.from} to ${p.previous.to}`);
  add("Previous period", "Calls", p.previous.calls);
  add("Previous period", "Meetings held", p.previous.meetings);
  add("Previous period", "Bookings made", p.previous.bookingsMade);
  add("Previous period", "Win rate %", p.previous.winPct);
  if (p.teamCompare) {
    add("Team comparison", "Team", p.teamCompare.team);
    add("Team comparison", "Rank", `${p.teamCompare.rank} of ${p.teamCompare.size}`);
    add("Team comparison", "Team avg calls", p.teamCompare.avg.calls);
    add("Team comparison", "Team avg meetings", p.teamCompare.avg.meetings);
    add("Team comparison", "Team avg leads won", p.teamCompare.avg.booked);
    add("Team comparison", "Team win rate %", p.teamCompare.avg.winPct);
  }
  for (const o of p.overdueList) add("Overdue follow-ups", `${o.leadName} (${o.leadCode})`, `due ${o.dueAt.toISOString()}${o.note ? ` · ${o.note}` : ""}`);
  for (const r of p.lostByReason) add("Lost reasons", r.reason, r.count);
  for (const r of p.bySource) add("Lead sources", r.source, `${r.leads} leads · ${r.won} won · ${r.lost} lost`);
  for (const d of p.daily) if (d.calls || d.meetings) add("Daily activity", d.date, `${d.calls} calls · ${d.meetings} meetings`);
  // Coaching notes are left out on purpose (owner, 16 Nov 2026): the file may be handed to the
  // employee, and the notes must stay hidden from the person they are about.

  for (const r of p.recordings) add("Call recordings", `${r.leadName} (${r.leadCode})`, `${r.durationSec ?? ""}s · ${r.createdAt.toISOString()}`);

  const filename = `work-record-${p.person.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${p.range.from}-to-${p.range.to}.csv`;
  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "people.export", entity: "user", entityId: userId, before: null, after: { from: p.range.from, to: p.range.to, file: filename } });
  return { filename, body: toCsv(["Section", "Item", "Value"], rows) };
}
