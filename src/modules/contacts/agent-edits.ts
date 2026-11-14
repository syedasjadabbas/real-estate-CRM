import { and, eq, inArray } from "drizzle-orm";
import { users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { notify } from "@/modules/notifications/service";
import type { DbOrTx } from "@/modules/leads/support";

/**
 * Owner's rules of 14 Nov 2026 for agents editing a customer (lead or client):
 * - an agent can never change a phone number (primary or extra); an Admin does that;
 * - a name an agent changes is kept in the history (old → new) and every Admin and Super Admin is told.
 */
export const AGENT_PHONE_MESSAGE = "Agents can't change phone numbers. Ask an Admin if a number is wrong.";

export function assertPhoneEditable(actor: Pick<Actor, "role">, phoneEdited: boolean) {
  if (actor.role === "agent" && phoneEdited) {
    throw new AppError("FORBIDDEN", AGENT_PHONE_MESSAGE, { fields: { phoneNumber: AGENT_PHONE_MESSAGE } });
  }
}

export async function notifyNameChange(
  db: DbOrTx,
  actor: Actor,
  record: { kind: "lead" | "client"; id: string; code?: string | null; from: string; to: string },
) {
  if (actor.role !== "agent" || record.from === record.to) return 0;
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.status, "active"), inArray(users.role, ["admin", "super_admin"])));
  const what = record.kind === "lead" ? `lead${record.code ? ` ${record.code}` : ""}` : "client";
  const link = record.kind === "lead" ? `/dashboard/leads/${record.id}` : `/dashboard/clients/${record.id}`;
  const at = Date.now();
  return notify(
    db,
    admins.map((a) => ({
      userId: a.id,
      type: "name_changed" as const,
      title: `${actor.name} renamed a ${record.kind}: ${record.from} → ${record.to}`,
      body: `On ${what}.`,
      link,
      dedupeKey: `name_changed:${record.kind}:${record.id}:${at}`,
    })),
    actor.id,
  );
}
