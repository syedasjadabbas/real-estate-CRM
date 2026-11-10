"use server";

import { refresh } from "next/cache";
import { decideImportBatch, submitImport } from "@/modules/leads/imports";
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

export async function submitImportAction(input: { projectId: string; fileName: string; csv: string }) {
  return run((db, actor) => submitImport(db, actor, input));
}

export async function decideImportAction(batchId: string, approve: boolean, note: string) {
  return run((db, actor) => decideImportBatch(db, actor, batchId, { approve, note }));
}
