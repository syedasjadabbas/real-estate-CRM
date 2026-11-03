"use server";

import { refresh } from "next/cache";
import { createUnit, setUnitStatus, updateUnit } from "@/modules/inventory/commands";
import { importUnits } from "@/modules/inventory/import";
import { updateProjectDimensions } from "@/modules/projects/commands";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/**
 * Server actions for the Inventory UI. Each one re-reads the session (never trusts the client),
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

export async function createUnitAction(input: Record<string, unknown>): Promise<ActionResult<{ unitId: string }>> {
  return run((db, actor) => createUnit(db, actor, input));
}

export async function updateUnitAction(unitId: string, input: Record<string, unknown>) {
  return run((db, actor) => updateUnit(db, actor, unitId, input));
}

export async function setUnitStatusAction(unitId: string, status: string, reason: string) {
  return run((db, actor) => setUnitStatus(db, actor, unitId, { status, reason }));
}

export async function updateDimensionsAction(projectId: string, input: Record<string, string[]>) {
  return run((db, actor) => updateProjectDimensions(db, actor, projectId, input));
}

export async function importUnitsAction(input: { projectId: string; csv: string; apply: boolean }) {
  return run((db, actor) => importUnits(db, actor, input));
}
