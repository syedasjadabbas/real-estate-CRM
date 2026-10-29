"use server";

import { refresh } from "next/cache";
import {
  addPaymentMethod,
  decideReversal,
  recordPayment,
  requestReversal,
  setPaymentMethodActive,
  updateFinanceSettings,
} from "@/modules/finance/commands";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/**
 * Server actions for the Finance UI. Each one re-reads the session (never trusts the client),
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

/** The form sends a key generated once per form, so a double submit or retry posts one payment. */
export async function recordPaymentAction(
  input: Record<string, unknown>,
): Promise<ActionResult<{ paymentId: string; receiptNo: number; replayed: boolean }>> {
  return run((db, actor) => recordPayment(db, actor, input));
}

export async function requestReversalAction(paymentId: string, reason: string) {
  return run((db, actor) => requestReversal(db, actor, paymentId, { reason }));
}

export async function decideReversalAction(requestId: string, approve: boolean, note: string) {
  return run((db, actor) => decideReversal(db, actor, requestId, { approve, note }));
}

export async function updateFinanceSettingsAction(input: Record<string, string>) {
  return run((db, actor) => updateFinanceSettings(db, actor, input));
}

export async function addPaymentMethodAction(name: string) {
  return run((db, actor) => addPaymentMethod(db, actor, { name }));
}

export async function setPaymentMethodActiveAction(methodId: string, active: boolean) {
  return run((db, actor) => setPaymentMethodActive(db, actor, methodId, active));
}
