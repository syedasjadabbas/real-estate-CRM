"use server";

import { refresh } from "next/cache";
import { saveEmployeeProfile } from "@/modules/employees/service";
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
