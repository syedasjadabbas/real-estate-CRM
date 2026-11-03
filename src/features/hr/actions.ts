"use server";

import { refresh } from "next/cache";
import { createAccount, reassignOwnedLeads, resetAccountPassword, setAccountStatus, updateAccount } from "@/modules/accounts/service";
import { createEmployeeRecord, saveEmployeeProfile, saveEmployeeRecord } from "@/modules/employees/service";
import { createHoliday, deleteHoliday, updateHoliday } from "@/modules/holidays/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/** Server actions for HR: session re-read on every call; the service layer enforces permissions. */
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

export async function createHolidayAction(input: Record<string, unknown>) {
  return run((db, actor) => createHoliday(db, actor, input));
}

export async function updateHolidayAction(holidayId: string, input: Record<string, unknown>) {
  return run((db, actor) => updateHoliday(db, actor, holidayId, input));
}

export async function deleteHolidayAction(holidayId: string) {
  return run((db, actor) => deleteHoliday(db, actor, holidayId));
}

export async function saveEmployeeProfileAction(userId: string, input: Record<string, unknown>) {
  return run((db, actor) => saveEmployeeProfile(db, actor, userId, input));
}

export async function createAccountAction(input: Record<string, unknown>) {
  return run((db, actor) => createAccount(db, actor, input));
}

export async function updateAccountAction(userId: string, input: Record<string, unknown>) {
  return run((db, actor) => updateAccount(db, actor, userId, input));
}

export async function resetAccountPasswordAction(userId: string, input: Record<string, unknown>) {
  return run((db, actor) => resetAccountPassword(db, actor, userId, input));
}

export async function setAccountStatusAction(userId: string, input: Record<string, unknown>) {
  return run((db, actor) => setAccountStatus(db, actor, userId, input));
}

export async function reassignOwnedLeadsAction(userId: string, input: Record<string, unknown>) {
  return run((db, actor) => reassignOwnedLeads(db, actor, userId, input));
}

export async function createEmployeeRecordAction(input: Record<string, unknown>) {
  return run((db, actor) => createEmployeeRecord(db, actor, input));
}

export async function saveEmployeeRecordAction(profileId: string, input: Record<string, unknown>) {
  return run((db, actor) => saveEmployeeRecord(db, actor, profileId, input));
}
