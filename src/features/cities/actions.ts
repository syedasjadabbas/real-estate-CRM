"use server";

import { refresh } from "next/cache";
import { addCity, updateCity } from "@/modules/cities/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/** Each action re-reads the session; the service layer enforces who may manage cities. */
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

export async function addCityAction(input: Record<string, unknown>) {
  return run((db, actor) => addCity(db, actor, input));
}

export async function updateCityAction(cityId: string, input: Record<string, unknown>) {
  return run((db, actor) => updateCity(db, actor, cityId, input));
}
