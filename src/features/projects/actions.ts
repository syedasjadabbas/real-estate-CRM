"use server";

import { refresh } from "next/cache";
import { createProject, updateProject, updateProjectPaymentPlan } from "@/modules/projects/commands";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/**
 * Server actions for the Projects UI. Each one re-reads the session (never trusts the client),
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

export async function createProjectAction(input: Record<string, unknown>): Promise<ActionResult<{ projectId: string }>> {
  return run((db, actor) => createProject(db, actor, input));
}

export async function updateProjectAction(projectId: string, input: Record<string, unknown>) {
  return run((db, actor) => updateProject(db, actor, projectId, input));
}

/** The project's payment plan (Admins and Super Admins). */
export async function updateProjectPaymentPlanAction(projectId: string, input: Record<string, unknown>) {
  return run((db, actor) => updateProjectPaymentPlan(db, actor, projectId, input));
}
