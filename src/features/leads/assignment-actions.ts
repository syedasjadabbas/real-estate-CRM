"use server";

import { refresh } from "next/cache";
import { updateAssignmentSettings } from "@/modules/leads/assignment";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

export async function updateAssignmentSettingsAction(input: Record<string, unknown>) {
  try {
    const actor = await requireActor();
    const data = await updateAssignmentSettings(getDb(), actor, input);
    refresh();
    return { ok: true, data } as ActionResult<typeof data>;
  } catch (error) {
    return toActionError(error) as ActionResult<never>;
  }
}
