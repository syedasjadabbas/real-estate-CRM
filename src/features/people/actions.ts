"use server";

import { refresh } from "next/cache";
import { addEmployeeNote, deleteEmployeeNote } from "@/modules/people/notes";
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

export const addEmployeeNoteAction = async (userId: string, body: string) => run((db, a) => addEmployeeNote(db, a, userId, { body }));
export const deleteEmployeeNoteAction = async (id: string) => run((db, a) => deleteEmployeeNote(db, a, id));
