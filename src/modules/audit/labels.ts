/**
 * Plain-English names for audit actions and record types (owner review, 16 Nov 2026). The log keeps
 * its stable codes; these are only for reading. A code without an entry is turned into words, so a
 * new action never shows blank.
 */

/** Action groups for the filter, keyed by the code's first part. */
export const ACTION_GROUP_LABELS: Record<string, string> = {
  lead: "Leads",
  lead_import: "Lead imports",
  client: "Clients",
  booking: "Bookings",
  payment: "Payments",
  finance: "Finance",
  unit: "Inventory",
  project: "Projects",
  task: "Tasks",
  meeting: "Meetings",
  team: "Teams",
  daily_report: "Teams",
  roster: "Teams",
  target: "Targets",
  user: "Staff accounts",
  employee: "HR",
  hr: "HR",
  attendance: "HR",
  leave: "HR",
  holiday: "HR",
  people: "Work profiles",
  performance: "Reports",
  app: "Settings",
  assignment: "Settings",
  city: "Settings",
  backup: "Backups",
  audit: "Audit log",
};

export const ACTION_LABELS: Record<string, string> = {
  "lead.create": "Created a lead",
  "lead.update": "Edited a lead",
  "lead.assign": "Assigned a lead",
  "lead.stage": "Changed a lead's stage",
  "lead.note": "Added a note / review",
  "lead.follow_up": "Set a follow-up",
  "lead.follow_up_done": "Completed a follow-up",
  "lead.follow_up_reschedule": "Rescheduled a follow-up",
  "lead.follow_up_cancel": "Cancelled a follow-up",
  "lead.follow_up_missed": "Follow-up missed",
  "lead.whatsapp_chat_upload": "Uploaded a WhatsApp chat",
  "lead.whatsapp_call_upload": "Uploaded a WhatsApp call",
  "lead.recording_upload": "Uploaded a call recording",
  "lead.document_upload": "Uploaded a document",
  "lead.verify_reject": "Rejected a lead's verification",
  "lead.verify_resubmit": "Resubmitted a lead for verification",
  "lead.lost_rejected": "Rejected a lost request",
  "lead.lost": "Marked a lead lost",
  "lead.claim": "Claimed a lead",
  "lead.review": "Added a review",
  "lead.favorite": "Starred a lead",
  "lead.unfavorite": "Unstarred a lead",
  "lead.lost_request": "Asked to mark a lead lost",
  "lead.lost_approved": "Approved a lost lead",
  "lead.verify_approve": "Approved a lead's verification",
  "lead.regenerated": "Recorded a repeat enquiry",
  "lead_import.created": "Started a lead import",
  "lead_import.submit": "Submitted a lead import",
  "lead_import.approve": "Approved a lead import",
  "client.create": "Created a client",
  "client.update": "Edited a client",
  "client.convert": "Converted a lead to a client",
  "client.create_from_lead": "Created a client from a lead",
  "client.create_from_booking": "Created a client from a booking",
  "booking.create": "Created a booking",
  "booking.update": "Edited a booking",
  "booking.stage": "Moved a booking's stage",
  "booking.confirm": "Confirmed a booking (Closed Won)",
  "booking.cancel": "Cancelled a booking",
  "booking.discount_approve": "Approved a booking discount",
  "booking.proof_upload": "Uploaded a payment proof",
  "booking.signed_form_upload": "Uploaded a signed form",
  "payment.record": "Recorded a payment",
  "payment.proof_upload": "Uploaded a payment proof",
  "payment.reversal_requested": "Asked to reverse a payment",
  "payment.reversal_approved": "Approved a payment reversal",
  "finance.report_export": "Downloaded a finance report",
  "finance.category_add": "Added a finance category",
  "unit.create": "Added a unit",
  "unit.update": "Edited a unit",
  "unit.status": "Changed a unit's status",
  "unit.import": "Imported units",
  "project.create": "Created a project",
  "project.deactivate": "Deactivated a project",
  "project.dimensions": "Changed project unit sizes",
  "task.create": "Created a task",
  "task.update": "Edited a task",
  "task.assign": "Assigned a task",
  "task.status": "Changed a task's status",
  "task.plan": "Saved a payment plan",
  "task.rebuild": "Rebuilt a payment plan",
  "task.price_sync": "Updated proposal prices",
  "task.price_reconciliation": "Reviewed changed proposal prices",
  "meeting.create": "Scheduled a meeting",
  "meeting.update": "Edited a meeting",
  "meeting.complete": "Marked a meeting held",
  "meeting.cancel": "Cancelled a meeting",
  "team.create": "Created a team",
  "team.update": "Edited a team",
  "team.members": "Changed team members",
  "daily_report.create": "Confirmed a daily report",
  "daily_report.update": "Updated a daily report",
  "roster.save": "Saved the roster",
  "target.create": "Set a target",
  "user.deactivate": "Deactivated a staff account",
  "user.reactivate": "Reactivated a staff account",
  "user.leads_shift": "Moved a person's leads",
  "employee.profile_create": "Created an HR record",
  "employee.profile_update": "Edited an HR record",
  "employee.record_create": "Created an HR record",
  "employee.record_update": "Edited an HR record",
  "employee.record_link": "Linked an HR record to an account",
  "hr.export": "Downloaded an HR file",
  "attendance.correct": "Corrected attendance",
  "holiday.create": "Added a holiday",
  "holiday.update": "Edited a holiday",
  "holiday.delete": "Deleted a holiday",
  "people.export": "Downloaded a work record",
  "people.note": "Added a coaching note",
  "people.note_delete": "Deleted a coaching note",
  "performance.pipeline_export": "Downloaded the pipeline by agent",
  "performance.export": "Downloaded the performance table",
  "targets.export": "Downloaded targets",
  "app.setting": "Changed a setting",
  "assignment.settings": "Changed lead assignment settings",
  "city.add": "Added a city",
  "city.add_from_other": "Added a typed city to the list",
  "city.rename": "Renamed a city",
  "city.activate": "Reactivated a city",
  "city.deactivate": "Deactivated a city",
  "backup.backup.succeeded": "Backup completed",
  "backup.backup.failed": "Backup failed",
  "backup.prune.succeeded": "Old backups removed",
  "audit.export": "Downloaded the audit log",
};

export const ENTITY_LABELS: Record<string, string> = {
  lead: "Lead",
  lead_import_batch: "Lead import",
  client: "Client",
  booking: "Booking",
  payment: "Payment",
  finance_report: "Finance report",
  report: "Report",
  finance_entry: "Finance entry",
  finance_category: "Finance category",
  unit: "Unit",
  project: "Project",
  task: "Task",
  meeting: "Meeting",
  team: "Team",
  daily_report: "Daily report",
  roster: "Roster",
  target: "Target",
  user: "Staff member",
  employee_profile: "HR record",
  attendance_record: "Attendance",
  leave_request: "Leave request",
  holiday: "Holiday",
  export: "Download",
  app_setting: "Setting",
  app_settings: "Settings",
  city: "City",
  backup_run: "Backup",
  audit_log: "Audit log",
};

const words = (code: string) => code.replace(/[._]+/g, " ").trim();
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function actionLabel(code: string) {
  return ACTION_LABELS[code] ?? capital(words(code));
}

export function entityLabel(code: string) {
  return ENTITY_LABELS[code] ?? capital(words(code));
}

export function actionGroup(code: string) {
  const head = code.split(".")[0];
  return ACTION_GROUP_LABELS[head] ?? capital(words(head));
}

/** Actions grouped for the filter: [group, [{ value, label }]] in a stable order. */
export function groupActions(codes: string[]) {
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const code of codes) {
    const g = actionGroup(code);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push({ value: code, label: actionLabel(code) });
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([g, items]) => [g, items.sort((x, y) => x.label.localeCompare(y.label))] as const);
}
