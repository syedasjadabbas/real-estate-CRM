"use server";

import { refresh } from "next/cache";
import { createTask, rebuildInstallments, setTaskStatus, updateTask } from "@/modules/tasks/commands";
import { updateProposalSettings } from "@/modules/tasks/settings";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/** Server actions for the Tasks UI: session re-read on every call; the service layer enforces permissions. */
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

export async function createTaskAction(input: Record<string, unknown>) {
  return run((db, actor) => createTask(db, actor, input));
}

export async function updateTaskAction(taskId: string, input: Record<string, unknown>) {
  return run((db, actor) => updateTask(db, actor, taskId, input));
}

export async function setTaskStatusAction(taskId: string, status: string) {
  return run((db, actor) => setTaskStatus(db, actor, taskId, { status }));
}

export async function rebuildInstallmentsAction(taskId: string) {
  return run((db, actor) => rebuildInstallments(db, actor, taskId));
}

export async function updateProposalSettingsAction(input: Record<string, unknown>) {
  return run((db, actor) => updateProposalSettings(db, actor, input));
}
