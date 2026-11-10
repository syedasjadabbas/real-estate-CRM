import "server-only";
import { assertCan } from "@/modules/leads/policy";
import type { Actor } from "@/server/auth/types";
import { voipStatus } from "./registry";
import type { VoipStatus } from "./types";

/**
 * Browser-calling status for a signed-in user with lead access (calls are made to leads).
 * Reads the runtime env; callers must be in a request-time render or route (after `connection()`
 * or another dynamic API) so the value isn't frozen at build.
 */
export function getVoipStatus(actor: Actor): VoipStatus {
  assertCan(actor, "view");
  return voipStatus(process.env);
}
