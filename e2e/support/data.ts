import { and, eq } from "drizzle-orm";
import { createLead } from "@/modules/leads/commands";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, leads, users } from "@/server/db/schema";
import { connectTestDb } from "../../tests/support/db";
import { testDatabaseUrl } from "./guard";
import { seed, uniquePhone, type Role } from "./seed";

/**
 * Direct TEST-database helpers for arranging and asserting. Each call opens and closes its own
 * connection; the guard refuses anything but the test database.
 */
async function withDb<T>(fn: (db: ReturnType<typeof connectTestDb>["db"]) => Promise<T>) {
  testDatabaseUrl();
  const { db, close } = connectTestDb();
  try {
    return await fn(db);
  } finally {
    await close();
  }
}

async function actorOf(db: ReturnType<typeof connectTestDb>["db"], role: Role) {
  const [u] = await db.select().from(users).where(eq(users.id, seed().users[role].id));
  return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
}

/** Creates a lead in the Test Project owned by `owner`, created by `by` (through the real service). */
export function createLeadFor(owner: Role, name: string, by: Role = "manager", extra: Record<string, unknown> = {}) {
  return withDb(async (db) => {
    const s = seed();
    const actor = await actorOf(db, by);
    const r = await createLead(db, actor, {
      projectId: s.projectId,
      name,
      phoneCountryCode: "+92",
      phoneNumber: uniquePhone(),
      sourceId: s.sourceId,
      ownerId: seed().users[owner].id,
      ...extra,
    });
    if (r.outcome !== "created") throw new Error("[e2e] createLeadFor");
    return r.leadId;
  });
}

export function leadStage(leadId: string) {
  return withDb(async (db) => (await db.select({ stage: leads.stage }).from(leads).where(eq(leads.id, leadId)))[0]?.stage);
}

export function auditCount(action: string, entityId?: string) {
  return withDb(async (db) => (await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.action, action), entityId ? eq(auditLogs.entityId, entityId) : undefined))).length);
}
