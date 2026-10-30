"use server";

import { refresh } from "next/cache";
import { markAllRead, updateReminderMinutes } from "@/modules/notifications/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

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

export async function markAllReadAction() {
  return run((db, actor) => markAllRead(db, actor));
}

/** Super admin / admin; the service checks the role. */
export async function updateReminderAction(input: Record<string, unknown>) {
  return run((db, actor) => updateReminderMinutes(db, actor, input));
}
