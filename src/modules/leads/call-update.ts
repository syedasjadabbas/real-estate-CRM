import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db";
import { followUps, leads, meetings } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { cancelMeeting, completeMeeting, createMeeting, updateMeeting } from "@/modules/meetings/commands";
import { MEETING_TYPES, MEETING_TYPE_LABELS } from "@/modules/meetings/constants";
import { addNote, changeStage, completeFollowUp, scheduleFollowUp } from "./commands";
import { LEAD_STAGES } from "./constants";
import { CALL_RESULTS, CALL_RESULT_LABELS } from "./call-results";
import { loadAccessibleLead, logActivity, markContact } from "./support";

const when = (message: string) =>
  z.iso.datetime({ offset: true, message }).transform((v) => new Date(v));

/** What became of a meeting. A no-show is closed as cancelled, marked as a no-show, and isn't contact. */
export const MEETING_OUTCOMES = ["completed", "no_show", "cancelled", "rescheduled"] as const;

const meetingResult = z.object({
  /** Null: a meeting that happened without being scheduled (a walk-in). */
  meetingId: z.uuid("Choose the meeting").nullable(),
  outcome: z.enum(MEETING_OUTCOMES, "Choose what happened"),
  /** When it was held (unscheduled) or the new time (rescheduled). */
  startsAt: when("Pick the date and time").optional().nullable(),
  type: z.enum(MEETING_TYPES, "Choose the meeting type").optional().nullable(),
});

const callUpdateSchema = z.object({
  result: z.enum(CALL_RESULTS, "Choose the call result"),
  minutes: z.coerce.number("Enter whole minutes").int("Enter whole minutes").min(0, "Enter whole minutes").max(600, "At most 600 minutes").optional().nullable(),
  note: z.string().trim().max(4000, "Use at most 4,000 characters").optional().default(""),
  stage: z.enum(LEAD_STAGES).optional().nullable(),
  meeting: z.object({ type: z.enum(MEETING_TYPES, "Choose the meeting type"), startsAt: when("Pick the meeting date and time") }).optional().nullable(),
  /** The follow-ups the agent confirms this activity fulfils; never assumed, overdue or not (client, 24 Nov 2026). */
  completeFollowUpIds: z.array(z.uuid()).max(50).optional().default([]),
  meetingResult: meetingResult.optional().nullable(),
  followUp: z.object({ dueAt: when("Pick the follow-up date and time"), note: z.string().trim().max(1000).optional().default("") }).optional().nullable(),
});

function fieldsOf(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join(".")] ??= issue.message;
  return fields;
}

/**
 * "Log activity" (owner, 14 Nov 2026; client, 24 Nov 2026): one save records what happened (a call, or
 * how a meeting went) on the timeline, moves the stage, books a meeting, completes the follow-ups the agent picked and schedules the next one. Everything runs in
 * one transaction through the usual commands (their checks and history included), so a refusal in any
 * part saves nothing.
 */
export async function logCallUpdate(db: Database, actor: Actor, leadId: string, input: unknown, now = new Date()) {
  const parsed = callUpdateSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: fieldsOf(parsed.error) });
  const data = parsed.data;
  const soon = now.getTime() - 60_000;
  if (data.meeting && data.meeting.startsAt.getTime() < soon) {
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { "meeting.startsAt": "Pick a time in the future" } });
  }
  if (data.followUp && data.followUp.dueAt.getTime() < soon) {
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { "followUp.dueAt": "Pick a time in the future" } });
  }

  const result = data.meetingResult;
  if (result) {
    const bad = (field: string, message: string) => new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { [field]: message } });
    if (data.note.length > 1000) throw bad("note", "Use at most 1,000 characters");
    if (!result.meetingId && result.outcome !== "completed") throw bad("meetingResult.meetingId", "Choose the meeting");
    if (!result.meetingId && !result.type) throw bad("meetingResult.type", "Choose the meeting type");
    if (!result.meetingId || result.outcome === "rescheduled") {
      if (!result.startsAt) throw bad("meetingResult.startsAt", "Pick the date and time");
      if (result.outcome === "rescheduled" && result.startsAt.getTime() < soon) throw bad("meetingResult.startsAt", "Pick a time in the future");
      if (result.outcome === "completed" && result.startsAt.getTime() > now.getTime() + 60_000) throw bad("meetingResult.startsAt", "The meeting can't be in the future");
    }
  }

  return db.transaction(async (tx) => {
    // Nested calls run as savepoints inside this transaction.
    const inTx = tx as unknown as Database;
    const { lead } = await loadAccessibleLead(tx, actor, leadId, true);
    const done: string[] = [];
    if (result) {
      await recordMeeting(tx, inTx, actor, lead, result, data.note || null, now);
      if (data.note) await tx.update(leads).set({ latestComment: data.note }).where(eq(leads.id, leadId));
      done.push(`meeting_${result.outcome}`);
    }
    if (data.result === "no_call") {
      // No call: only a note, when one was written (a meeting keeps its own).
      if (data.note && !result) {
        await addNote(inTx, actor, leadId, { body: data.note });
        done.push("note");
      }
    } else {
      const summary = [`Call · ${CALL_RESULT_LABELS[data.result]}`, data.minutes ? `${data.minutes} min` : null].filter(Boolean).join(" · ");
      await addNote(inTx, actor, leadId, { body: data.note ? `${summary}\n${data.note}` : summary });
      if (data.result === "talked") await markContact(tx, leadId, now);
      done.push("call");
    }
    // A completed meeting has already moved the lead, so the stage asked for may be done.
    const [{ stage: stageNow }] = await tx.select({ stage: leads.stage }).from(leads).where(eq(leads.id, leadId));
    if (data.stage && data.stage !== stageNow && !(data.meeting && data.stage === "meeting_scheduled")) {
      await changeStage(inTx, actor, leadId, { stage: data.stage, remarks: data.note || undefined });
      done.push("stage");
    }
    if (data.meeting) {
      await createMeeting(inTx, actor, {
        title: `${MEETING_TYPE_LABELS[data.meeting.type]} with ${lead.name}`,
        type: data.meeting.type,
        startsAt: data.meeting.startsAt.toISOString(),
        leadId,
        notes: data.note || null,
        moveLead: true,
      });
      done.push("meeting");
    }
    const picked = [...new Set(data.completeFollowUpIds)];
    if (picked.length) {
      const open = await tx
        .select({ id: followUps.id })
        .from(followUps)
        .where(and(eq(followUps.leadId, leadId), eq(followUps.status, "pending"), inArray(followUps.id, picked)));
      if (open.length !== picked.length) {
        throw new AppError("CONFLICT", "A follow-up you picked is no longer pending on this lead. Reload and try again.");
      }
      for (const f of open) await completeFollowUp(inTx, actor, f.id);
      done.push("followUpDone");
    }
    if (data.followUp) {
      await scheduleFollowUp(inTx, actor, leadId, { dueAt: data.followUp.dueAt.toISOString(), note: data.followUp.note || undefined }, now);
      done.push("followUp");
    }
    return { done };
  });
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The outcome of a meeting on this lead, through the meeting's own commands. */
async function recordMeeting(tx: Tx, inTx: Database, actor: Actor, lead: typeof leads.$inferSelect, r: z.output<typeof meetingResult>, note: string | null, now: Date) {
  if (!r.meetingId) {
    const { meetingId } = await createMeeting(inTx, actor, {
      title: `${MEETING_TYPE_LABELS[r.type!]} with ${lead.name}`,
      type: r.type!,
      startsAt: r.startsAt!.toISOString(),
      leadId: lead.id,
      moveLead: false,
    });
    await completeMeeting(inTx, actor, meetingId, { note, moveLead: true });
    return;
  }
  const [meeting] = await tx.select().from(meetings).where(and(eq(meetings.id, r.meetingId), eq(meetings.leadId, lead.id)));
  if (!meeting || meeting.status !== "scheduled") throw new AppError("CONFLICT", "That meeting is no longer scheduled on this lead. Reload and try again.");
  if (r.outcome === "completed") await completeMeeting(inTx, actor, meeting.id, { note, moveLead: true });
  else if (r.outcome === "cancelled") await cancelMeeting(inTx, actor, meeting.id, { note });
  else if (r.outcome === "no_show") {
    if (meeting.startsAt > now) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { "meetingResult.outcome": "This meeting's time hasn't come yet" } });
    await cancelMeeting(inTx, actor, meeting.id, { note, noShow: true });
  } else {
    const startsAt = r.startsAt!;
    const endsAt = meeting.endsAt ? new Date(meeting.endsAt.getTime() + startsAt.getTime() - meeting.startsAt.getTime()) : null;
    await updateMeeting(inTx, actor, meeting.id, { startsAt, endsAt });
    await logActivity(tx, { leadId: lead.id, actorId: actor.id, type: "meeting", data: { action: "rescheduled", meetingId: meeting.id, title: meeting.title, from: meeting.startsAt, startsAt, note } });
  }
}
