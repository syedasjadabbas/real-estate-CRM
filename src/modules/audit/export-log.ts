import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { auditLogs } from "@/server/db/schema";

/**
 * Records a CSV download in the audit log (owner review, 16 Nov 2026): who downloaded what, for which
 * range or period, and how many rows. Nothing about the rows themselves is stored.
 */
export async function logExport(
  db: Database,
  actor: Actor & { ip?: string | null },
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown>,
) {
  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action, entity, entityId, before: null, after: details });
}
