"use server";

import { refresh } from "next/cache";
import {
  addClientNote,
  assignClient,
  completeClientFollowUp,
  convertLeadToClient,
  createClient,
  scheduleClientFollowUp,
  updateClient,
  type ConvertOutcome,
} from "@/modules/clients/commands";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/**
 * Server actions for the Clients UI. Each one re-reads the session (never trusts the client),
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

export async function createClientAction(input: Record<string, unknown>): Promise<ActionResult<{ clientId: string }>> {
  return run((db, actor) => createClient(db, actor, input));
}

export async function convertLeadAction(leadId: string, onExisting: "reject" | "link" = "reject"): Promise<ActionResult<ConvertOutcome>> {
  return run((db, actor) => convertLeadToClient(db, actor, { leadId, onExisting }));
}

export async function updateClientAction(clientId: string, input: Record<string, unknown>) {
  return run((db, actor) => updateClient(db, actor, clientId, input));
}

export async function assignClientAction(clientId: string, ownerId: string) {
  return run((db, actor) => assignClient(db, actor, clientId, { ownerId }));
}

export async function addClientNoteAction(clientId: string, body: string) {
  return run((db, actor) => addClientNote(db, actor, clientId, { body }));
}

export async function scheduleClientFollowUpAction(clientId: string, input: { dueAt: string; note?: string }) {
  return run((db, actor) => scheduleClientFollowUp(db, actor, clientId, input));
}

export async function completeClientFollowUpAction(followUpId: string) {
  return run((db, actor) => completeClientFollowUp(db, actor, followUpId));
}
