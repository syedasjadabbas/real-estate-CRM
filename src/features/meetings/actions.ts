"use server";

import { refresh } from "next/cache";
import { cancelMeeting, completeMeeting, createMeeting, updateMeeting } from "@/modules/meetings/commands";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/** Server actions for the Meetings UI: session re-read on every call; the service layer enforces permissions. */
async function run<T>(fn: (db: ReturnType<typeof getDb>, actor: Awaited<ReturnType<typeof requireActor>>) => Promise<T>) {
  try {
    const actor = await requireActor();
    const data = await fn(getDb(), actor);
    refresh();
    return { ok: true, data } as ActionResult<T>;
  } catch (error) {
    return toActionError(error) as ActionResult<T>;
  }
}

export async function createMeetingAction(input: Record<string, unknown>) {
  return run((db, actor) => createMeeting(db, actor, input));
}

export async function updateMeetingAction(meetingId: string, input: Record<string, unknown>) {
  return run((db, actor) => updateMeeting(db, actor, meetingId, input));
}

export async function completeMeetingAction(meetingId: string, input: { note: string; moveLead: boolean }) {
  return run((db, actor) => completeMeeting(db, actor, meetingId, input));
}

export async function cancelMeetingAction(meetingId: string, input: { note: string }) {
  return run((db, actor) => cancelMeeting(db, actor, meetingId, input));
}
