"use server";

import { refresh } from "next/cache";
import {
  addNote,
  addReview,
  assignLead,
  changeStage,
  completeFollowUp,
  createLead,
  decideLostRequest,
  markLost,
  scheduleFollowUp,
  setFavorite,
  updateLead,
  type CreateLeadOutcome,
} from "@/modules/leads/commands";
import { completeNextFollowUp } from "@/modules/leads/follow-ups";
import { claimLead } from "@/modules/leads/claims";
import { resubmitLead, verifyLead } from "@/modules/leads/verification";
import { logCallUpdate } from "@/modules/leads/call-update";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/**
 * Server actions for the Leads UI. Each one re-reads the session (never trusts the client),
 * delegates to the service layer (which enforces permissions) and refreshes the router.
 */
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

export async function createLeadAction(input: Record<string, unknown>): Promise<ActionResult<CreateLeadOutcome>> {
  return run((db, actor) => createLead(db, actor, input));
}

/** Admin or Super Admin approves or rejects (with a reason) a lead an agent added. */
export async function verifyLeadAction(leadId: string, approve: boolean, note?: string) {
  return run((db, actor) => verifyLead(db, actor, leadId, { approve, note }));
}

/** The agent sends a corrected, rejected lead back for verification. */
export async function resubmitLeadAction(leadId: string) {
  return run((db, actor) => resubmitLead(db, actor, leadId));
}

export async function updateLeadAction(leadId: string, input: Record<string, unknown>) {
  return run((db, actor) => updateLead(db, actor, leadId, input));
}

export async function changeStageAction(leadId: string, stage: string, remarks?: string) {
  return run((db, actor) => changeStage(db, actor, leadId, { stage, remarks }));
}

export async function assignLeadAction(leadId: string, ownerId: string) {
  return run((db, actor) => assignLead(db, actor, leadId, { ownerId }));
}

export async function addNoteAction(leadId: string, body: string) {
  return run((db, actor) => addNote(db, actor, leadId, { body }));
}

export async function scheduleFollowUpAction(leadId: string, input: { dueAt: string; note?: string }) {
  return run((db, actor) => scheduleFollowUp(db, actor, leadId, input));
}

export async function completeFollowUpAction(followUpId: string) {
  return run((db, actor) => completeFollowUp(db, actor, followUpId));
}

export async function completeNextFollowUpAction(leadId: string) {
  return run((db, actor) => completeNextFollowUp(db, actor, leadId));
}

export async function setFavoriteAction(leadId: string, favorite: boolean) {
  return run((db, actor) => setFavorite(db, actor, leadId, favorite));
}

export async function markLostAction(leadId: string, input: { lostReasonId: string; note?: string }) {
  return run((db, actor) => markLost(db, actor, leadId, input));
}

export async function decideLostAction(approvalId: string, approve: boolean, comment?: string) {
  return run((db, actor) => decideLostRequest(db, actor, approvalId, { approve, comment }));
}

export async function addReviewAction(leadId: string, body: string) {
  return run((db, actor) => addReview(db, actor, leadId, { body }));
}

/** Claim an unassigned lead; the first successful claim wins. */
export async function claimLeadAction(leadId: string) {
  return run((db, actor) => claimLead(db, actor, leadId));
}

/** "Update after call": note, stage, meeting and next follow-up in one save. */
export async function logCallUpdateAction(leadId: string, input: Record<string, unknown>) {
  return run((db, actor) => logCallUpdate(db, actor, leadId, input));
}
