"use server";

import { refresh } from "next/cache";
import { checkIn, checkOut, correctAttendance, updateAttendanceSettings } from "@/modules/attendance/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/** Attendance server actions: the session is read on every call; the service enforces permissions. */
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

export const checkInAction = async () => run((db, a) => checkIn(db, a));
export const checkOutAction = async () => run((db, a) => checkOut(db, a));
export const correctAttendanceAction = async (input: Record<string, unknown>) => run((db, a) => correctAttendance(db, a, input));
export const updateAttendanceSettingsAction = async (input: Record<string, unknown>) => run((db, a) => updateAttendanceSettings(db, a, input));
