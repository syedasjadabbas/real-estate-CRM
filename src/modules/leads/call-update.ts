import { and, eq, lte } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db";
import { followUps } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { createMeeting } from "@/modules/meetings/commands";
import { MEETING_TYPES, MEETING_TYPE_LABELS } from "@/modules/meetings/constants";
import { addNote, changeStage, completeFollowUp, scheduleFollowUp } from "./commands";
import { LEAD_STAGES } from "./constants";
import { CALL_RESULTS, CALL_RESULT_LABELS } from "./call-results";
import { loadAccessibleLead } from "./support";

const when = (message: string) =>
  z.iso.datetime({ offset: true, message }).transform((v) => new Date(v));

const callUpdateSchema = z.object({
  result: z.enum(CALL_RESULTS, "Choose the call result"),
  minutes: z.coerce.number("Enter whole minutes").int("Enter whole minutes").min(0, "Enter whole minutes").max(600, "At most 600 minutes").optional().nullable(),
  note: z.string().trim().max(4000, "Use at most 4,000 characters").optional().default(""),
  stage: z.enum(LEAD_STAGES).optional().nullable(),
  meeting: z.object({ type: z.enum(MEETING_TYPES, "Choose the meeting type"), startsAt: when("Pick the meeting date and time") }).optional().nullable(),
  followUp: z.object({ dueAt: when("Pick the follow-up date and time"), note: z.string().trim().max(1000).optional().default("") }).optional().nullable(),
});

function fieldsOf(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join(".")] ??= issue.message;
  return fields;
}

/**
 * "Update after call" (owner, 14 Nov 2026): one save records the call on the timeline, moves the stage,
 * books a meeting, closes the follow-ups that were due and schedules the next one. Everything runs in
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

  return db.transaction(async (tx) => {
    // Nested calls run as savepoints inside this transaction.
    const inTx = tx as unknown as Database;
    const { lead } = await loadAccessibleLead(tx, actor, leadId, true);
    const done: string[] = [];
    if (data.result === "no_call") {
      // No call: only a note, when one was written.
      if (data.note) {
        await addNote(inTx, actor, leadId, { body: data.note });
        done.push("note");
      }
    } else {
      const summary = [`Call · ${CALL_RESULT_LABELS[data.result]}`, data.minutes ? `${data.minutes} min` : null].filter(Boolean).join(" · ");
      await addNote(inTx, actor, leadId, { body: data.note ? `${summary}\n${data.note}` : summary });
      done.push("call");
    }
    if (data.stage && data.stage !== lead.stage && !(data.meeting && data.stage === "meeting_scheduled")) {
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
    if (data.followUp) {
      // The follow-ups that were due by now are what this call answered.
      const due = await tx
        .select({ id: followUps.id })
        .from(followUps)
        .where(and(eq(followUps.leadId, leadId), eq(followUps.status, "pending"), lte(followUps.dueAt, now)));
      for (const f of due) await completeFollowUp(inTx, actor, f.id);
      await scheduleFollowUp(inTx, actor, leadId, { dueAt: data.followUp.dueAt.toISOString(), note: data.followUp.note || undefined }, now);
      done.push("followUp");
    }
    return { done };
  });
}
