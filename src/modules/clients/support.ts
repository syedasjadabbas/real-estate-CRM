import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { teamMemberIds as leadTeamMemberIds, type DbOrTx } from "@/modules/leads/support";
import { auditLogs, clientActivities, clientFollowUps, clients } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { fieldErrors } from "@/modules/leads/validation";
import type { z } from "zod";
import { canAccessClient, clientScope } from "./policy";

/** Members of the teams the actor manages: the same "my team" as Leads (only managers have one). */
export const teamMemberIds = leadTeamMemberIds;

/** SQL filter restricting clients to the actor's scope. */
export function clientScopeFilter(actor: Actor, memberIds: string[]): SQL {
  switch (clientScope(actor.role)) {
    case "all":
      return sql`true`;
    case "team":
      return inArray(clients.ownerId, [actor.id, ...memberIds]);
    case "own":
      return eq(clients.ownerId, actor.id);
    default:
      throw forbidden();
  }
}

/** Loads a client the actor may access; 404 otherwise (no existence leak). */
export async function loadAccessibleClient(db: DbOrTx, actor: Actor, clientId: string, forUpdate = false) {
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw notFound("Client");
  const query = db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  const [client] = forUpdate ? await query.for("update") : await query;
  if (!client) throw notFound("Client");
  const members = await teamMemberIds(db, actor);
  if (!canAccessClient(actor, client.ownerId, members)) throw notFound("Client");
  return { client, members };
}

export async function logClientActivity(
  db: DbOrTx,
  values: {
    clientId: string;
    actorId: string | null;
    type: typeof clientActivities.$inferInsert.type;
    body?: string | null;
    data?: Record<string, unknown>;
  },
) {
  await db.insert(clientActivities).values({
    clientId: values.clientId,
    actorId: values.actorId,
    type: values.type,
    body: values.body ?? null,
    data: values.data ?? null,
  });
}

export async function auditClient(db: DbOrTx, actor: Actor, action: string, entityId: string, before: unknown, after: unknown) {
  await db.insert(auditLogs).values({
    actorId: actor.id,
    ip: actor.ip ?? null,
    action,
    entity: "client",
    entityId,
    before: before ?? null,
    after: after ?? null,
  });
}

/** Recomputes the denormalised next follow-up time from pending follow-ups. */
export async function refreshClientNextFollowUp(db: DbOrTx, clientId: string) {
  const [row] = await db
    .select({ next: sql<Date | null>`min(${clientFollowUps.dueAt})` })
    .from(clientFollowUps)
    .where(and(eq(clientFollowUps.clientId, clientId), eq(clientFollowUps.status, "pending")));
  await db
    .update(clients)
    .set({ nextFollowUpAt: row?.next ? new Date(row.next) : null })
    .where(eq(clients.id, clientId));
}

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: fieldErrors(result.error) });
  }
  return result.data;
}
