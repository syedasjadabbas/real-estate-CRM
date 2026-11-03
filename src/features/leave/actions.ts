"use server";

import { refresh } from "next/cache";
import {
  cancelApprovedLeave,
  decideLeave,
  decideLeaveCancellation,
  requestLeaveCancellation,
  submitLeave,
  updateLeaveSettings,
  withdrawLeave,
} from "@/modules/leave/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/** Leave server actions: session re-read on every call; the service enforces every rule. */
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

export const submitLeaveAction = async (input: Record<string, unknown>) => run((db, a) => submitLeave(db, a, input));
export const withdrawLeaveAction = async (id: string) => run((db, a) => withdrawLeave(db, a, id));
export const requestLeaveCancellationAction = async (id: string, input: Record<string, unknown>) => run((db, a) => requestLeaveCancellation(db, a, id, input));
export const decideLeaveAction = async (id: string, input: Record<string, unknown>) => run((db, a) => decideLeave(db, a, id, input));
export const decideLeaveCancellationAction = async (id: string, input: Record<string, unknown>) => run((db, a) => decideLeaveCancellation(db, a, id, input));
export const cancelApprovedLeaveAction = async (id: string, input: Record<string, unknown>) => run((db, a) => cancelApprovedLeave(db, a, id, input));
export const updateLeaveSettingsAction = async (input: Record<string, unknown>) => run((db, a) => updateLeaveSettings(db, a, input));
