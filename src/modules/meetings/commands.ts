import { and, eq } from "drizzle-orm";
import { assertWorkable } from "@/modules/leads/verification";
import type { Database } from "@/server/db";
import { auditLogs, leads, meetingHistory, meetings, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, notFound } from "@/server/errors";
import { STAGE_LABELS, type LeadStage } from "@/modules/leads/constants";
import { hasOpenBooking, loadAccessibleLead, logActivity, teamMemberIds, touchValues, type DbOrTx, type Tx } from "@/modules/leads/support";
import { parseTask as parse, taskFieldError as fieldError } from "@/modules/tasks/support";
import { COMPLETE_MOVES_FROM, MEETING_STATUS_LABELS, SCHEDULE_MOVES_FROM } from "./constants";
import { ORGANIZER_ROLES, assertCanMeeting, canAccessMeeting, canPickOrganizer } from "./policy";
import { cancelSchema, completeSchema, createMeetingSchema, updateMeetingSchema } from "./validation";

async function record(tx: DbOrTx, actor: Actor, meetingId: string, action: string, data: Record<string, unknown>, before: unknown = null) {
  await tx.insert(meetingHistory).values({ meetingId, actorId: actor.id, action, data });
  await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: `meeting.${action}`, entity: "meeting", entityId: meetingId, before, after: data });
}

/** Loads a meeting the actor may see; 404 otherwise (no existence leak). */
export async function loadAccessibleMeeting(tx: DbOrTx, actor: Actor, meetingId: string, forUpdate = false) {
  if (!/^[0-9a-f-]{36}$/i.test(meetingId)) throw notFound("Meeting");
  const query = tx.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  const [meeting] = forUpdate ? await query.for("update") : await query;
  if (!meeting) throw notFound("Meeting");
  const members = await teamMemberIds(tx, actor);
  if (!canAccessMeeting(actor, meeting, members)) throw notFound("Meeting");
  return { meeting, members };
}

async function checkOrganizer(tx: DbOrTx, actor: Actor, organizerId: string, members: string[]) {
  const [user] = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, organizerId)).limit(1);
  if (!user || user.status !== "active" || !ORGANIZER_ROLES.includes(user.role)) throw fieldError("organizerId", "Choose an active team member");
  if (!canPickOrganizer(actor, organizerId, members)) {
    throw fieldError("organizerId", actor.role === "agent" ? "Agents organize their own meetings" : "You can pick yourself or your team");
  }
}

async function accessibleLead(tx: Tx, actor: Actor, leadId: string) {
  let lead;
  try {
    lead = (await loadAccessibleLead(tx, actor, leadId, true)).lead;
  } catch {
    throw fieldError("leadId", "Choose a lead you can access");
  }
  assertWorkable(actor, lead);
  return lead;
}

/**
 * Decisions D1 / D2: moves the lead forward to `to` only from the allowed stages, with the same
 * stage history and audit as a manual stage change. Returns whether it moved.
 */
async function moveLeadForward(tx: Tx, actor: Actor, lead: typeof leads.$inferSelect, to: LeadStage, from: LeadStage[], reason: string) {
  if (!from.includes(lead.stage)) return false;
  // The stage of a lead with an open booking follows the booking (FR-080); the meeting is still saved.
  if (await hasOpenBooking(tx, lead.id)) return false;
  const now = new Date();
  const [row] = await tx
    .update(leads)
    .set({ stage: to, stageChangedAt: now, ...touchValues(lead, now) })
    .where(and(eq(leads.id, lead.id), eq(leads.stage, lead.stage)))
    .returning({ id: leads.id });
  if (!row) throw new AppError("CONFLICT", "The lead was changed by someone else. Reload and try again.");
  await logActivity(tx, {
    leadId: lead.id,
    actorId: actor.id,
    type: "stage_change",
    data: { from: lead.stage, to, fromLabel: STAGE_LABELS[lead.stage], toLabel: STAGE_LABELS[to], reason },
  });
  await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "lead.stage", entity: "lead", entityId: lead.id, before: { stage: lead.stage }, after: { stage: to, reason } });
  return true;
}

/** FR-100 schedule. Counts as a lead touch (FR-028) and is logged on the lead timeline. */
export async function createMeeting(db: Database, actor: Actor, input: unknown) {
  assertCanMeeting(actor, "create");
  const data = parse(createMeetingSchema, input);
  return db.transaction(async (tx) => {
    const members = await teamMemberIds(tx, actor);
    const organizerId = data.organizerId ?? actor.id;
    await checkOrganizer(tx, actor, organizerId, members);
    const lead = await accessibleLead(tx, actor, data.leadId);
    const [meeting] = await tx
      .insert(meetings)
      .values({
        title: data.title,
        startsAt: data.startsAt!,
        endsAt: data.endsAt,
        type: data.type,
        location: data.location,
        organizerId,
        leadId: lead.id,
        notes: data.notes,
        createdById: actor.id,
      })
      .returning({ id: meetings.id });
    const now = new Date();
    const movedLead = data.moveLead ? await moveLeadForward(tx, actor, lead, "meeting_scheduled", SCHEDULE_MOVES_FROM, `Meeting scheduled: ${data.title}`) : false;
    if (!movedLead) await tx.update(leads).set(touchValues(lead, now)).where(eq(leads.id, lead.id));
    await logActivity(tx, { leadId: lead.id, actorId: actor.id, type: "meeting", data: { action: "scheduled", meetingId: meeting.id, title: data.title, startsAt: data.startsAt } });
    await record(tx, actor, meeting.id, "create", { title: data.title, type: data.type, startsAt: data.startsAt, organizerId, leadId: lead.id, movedLead });
    return { meetingId: meeting.id, movedLead };
  });
}

const TRACKED = ["title", "startsAt", "endsAt", "type", "location", "organizerId", "leadId", "notes"] as const;
const same = (a: unknown, b: unknown) => (a instanceof Date || b instanceof Date ? new Date(a as Date).getTime() === new Date(b as Date).getTime() : (a ?? null) === (b ?? null));

/** Edits a Scheduled meeting (assumption M-A5: completed / cancelled meetings are final). */
export async function updateMeeting(db: Database, actor: Actor, meetingId: string, input: unknown) {
  assertCanMeeting(actor, "edit");
  const data = parse(updateMeetingSchema, input);
  return db.transaction(async (tx) => {
    const { meeting, members } = await loadAccessibleMeeting(tx, actor, meetingId, true);
    if (meeting.status !== "scheduled") throw new AppError("BUSINESS_RULE", `A ${MEETING_STATUS_LABELS[meeting.status].toLowerCase()} meeting can't be edited.`);
    const next = {
      title: data.title ?? meeting.title,
      startsAt: data.startsAt ?? meeting.startsAt,
      endsAt: "endsAt" in data ? (data.endsAt ?? null) : meeting.endsAt,
      type: data.type ?? meeting.type,
      location: "location" in data ? (data.location ?? null) : meeting.location,
      organizerId: data.organizerId ?? meeting.organizerId,
      leadId: data.leadId ?? meeting.leadId,
      notes: "notes" in data ? (data.notes ?? null) : meeting.notes,
    };
    if (next.endsAt && next.endsAt <= next.startsAt) throw fieldError("endsAt", "End must be after the start");
    if (next.organizerId !== meeting.organizerId) await checkOrganizer(tx, actor, next.organizerId, members);
    if (next.leadId !== meeting.leadId) await accessibleLead(tx, actor, next.leadId);

    const changed = TRACKED.filter((k) => !same(next[k], meeting[k]));
    if (changed.length === 0) return { changed: [] as string[] };
    await tx.update(meetings).set({ ...next, updatedAt: new Date() }).where(eq(meetings.id, meeting.id));
    await record(
      tx,
      actor,
      meeting.id,
      "update",
      Object.fromEntries(changed.map((k) => [k, next[k]])),
      Object.fromEntries(changed.map((k) => [k, meeting[k]])),
    );
    if (changed.includes("organizerId")) await record(tx, actor, meeting.id, "organizer", { from: meeting.organizerId, to: next.organizerId });
    return { changed };
  });
}

/** Scheduled → Completed or Cancelled, guarded on the status the caller saw. */
async function close(tx: Tx, meetingId: string, to: "completed" | "cancelled") {
  const now = new Date();
  const [row] = await tx
    .update(meetings)
    .set({ status: to, updatedAt: now, ...(to === "completed" ? { completedAt: now } : { cancelledAt: now }) })
    .where(and(eq(meetings.id, meetingId), eq(meetings.status, "scheduled")))
    .returning({ id: meetings.id });
  if (!row) throw new AppError("CONFLICT", "This meeting was changed by someone else. Reload and try again.");
}

/** FR-101 with decision D1: optionally moves the lead forward to Meeting Done. */
export async function completeMeeting(db: Database, actor: Actor, meetingId: string, input: unknown) {
  assertCanMeeting(actor, "edit");
  const { note, moveLead } = parse(completeSchema, input);
  return db.transaction(async (tx) => {
    const { meeting } = await loadAccessibleMeeting(tx, actor, meetingId, true);
    if (meeting.status !== "scheduled") throw new AppError("BUSINESS_RULE", `This meeting is already ${MEETING_STATUS_LABELS[meeting.status].toLowerCase()}.`);
    await close(tx, meeting.id, "completed");
    // The lead may be outside the actor's lead scope (e.g. a manager's lead on a team meeting): then it is not moved.
    const [lead] = await tx.select().from(leads).where(eq(leads.id, meeting.leadId)).for("update");
    let movedLead = false;
    if (moveLead && lead && !lead.deletedAt) {
      try {
        await loadAccessibleLead(tx, actor, lead.id);
        movedLead = await moveLeadForward(tx, actor, lead, "meeting_done", COMPLETE_MOVES_FROM, `Meeting completed: ${meeting.title}`);
      } catch (error) {
        if (!(error instanceof AppError && error.code === "NOT_FOUND")) throw error;
      }
    }
    await logActivity(tx, { leadId: meeting.leadId, actorId: actor.id, type: "meeting", data: { action: "completed", meetingId: meeting.id, title: meeting.title, startsAt: meeting.startsAt, note } });
    await record(tx, actor, meeting.id, "complete", { note, movedLead }, { status: "scheduled" });
    return { movedLead };
  });
}

export async function cancelMeeting(db: Database, actor: Actor, meetingId: string, input: unknown) {
  assertCanMeeting(actor, "edit");
  const { note } = parse(cancelSchema, input);
  return db.transaction(async (tx) => {
    const { meeting } = await loadAccessibleMeeting(tx, actor, meetingId, true);
    if (meeting.status !== "scheduled") throw new AppError("BUSINESS_RULE", `This meeting is already ${MEETING_STATUS_LABELS[meeting.status].toLowerCase()}.`);
    await close(tx, meeting.id, "cancelled");
    await logActivity(tx, { leadId: meeting.leadId, actorId: actor.id, type: "meeting", data: { action: "cancelled", meetingId: meeting.id, title: meeting.title, startsAt: meeting.startsAt, note } });
    await record(tx, actor, meeting.id, "cancel", { note }, { status: "scheduled" });
    return { cancelled: true };
  });
}
