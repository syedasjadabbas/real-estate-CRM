"use server";

import { refresh } from "next/cache";
import { updateRetentionSettings } from "@/modules/security/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/** Super admin / admin; the service enforces the role and the confirmation for enabling deletion. */
export async function updateRetentionSettingsAction(input: Record<string, unknown>) {
  try {
    const actor = await requireActor();
    const data = await updateRetentionSettings(getDb(), actor, input);
    refresh();
    return { ok: true, data } as ActionResult<typeof data>;
  } catch (error) {
    return toActionError(error) as ActionResult<{ changed: string[] }>;
  }
}
