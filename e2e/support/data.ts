import { and, eq } from "drizzle-orm";
import { createBooking } from "@/modules/bookings/commands";
import { createUnit } from "@/modules/inventory/commands";
import { createLead, scheduleFollowUp } from "@/modules/leads/commands";
import { createTeam, setTeamMembers } from "@/modules/teams/commands";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, bookingPayments, bookings, leads, units, users } from "@/server/db/schema";
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

/** An Available unit in the Test Project (through the real inventory service). */
export function createAvailableUnit(unitNo: string) {
  return withDb(async (db) => {
    const actor = await actorOf(db, "superAdmin");
    const { unitId } = await createUnit(db, actor, { projectId: seed().projectId, unitNo, areaSqft: "500", basePrice: "10000000" });
    return unitId;
  });
}

/** A team with agent1 as member (through the real teams service). */
export function createTeamWithAgent(name: string) {
  return withDb(async (db) => {
    const actor = await actorOf(db, "superAdmin");
    const { teamId } = await createTeam(db, actor, { name });
    await setTeamMembers(db, actor, teamId, { userIds: [seed().users.agent1.id] });
    return teamId;
  });
}

/** The payment recorded by global setup (the seeded booking's 500,000 token). */
export function seededPaymentId() {
  return withDb(async (db) => (await db.select({ id: bookingPayments.id }).from(bookingPayments).where(eq(bookingPayments.kind, "payment")).orderBy(bookingPayments.recordedAt).limit(1))[0].id);
}

/** An open booking (Negotiation) for `leadId` on `unitId`, created by the manager through the real service. */
export function createBookingFor(leadId: string, unitId: string) {
  return withDb(async (db) => {
    const actor = await actorOf(db, "manager");
    const { bookingId } = await createBooking(db, actor, { projectId: seed().projectId, leadId, unitId, ratePerSqft: "20000", tokenAmount: "100000" });
    return bookingId;
  });
}

/** Stage of a booking and status of its unit, for asserting that lead, booking and unit agree. */
export function bookingState(bookingId: string) {
  return withDb(async (db) => {
    const [row] = await db.select({ stage: bookings.stage, unitStatus: units.status }).from(bookings).innerJoin(units, eq(units.id, bookings.unitId)).where(eq(bookings.id, bookingId));
    return row;
  });
}

/** A pending follow-up on `leadId`, `minutesFromNow` from now (negative = already overdue), scheduled by the lead's owner. */
export function scheduleFollowUpFor(owner: Role, leadId: string, minutesFromNow: number, note: string) {
  return withDb(async (db) => {
    const actor = await actorOf(db, owner);
    const now = new Date();
    const dueAt = new Date(now.getTime() + minutesFromNow * 60_000);
    // Scheduled "before" it fell due, as the service only takes future times.
    await scheduleFollowUp(db, actor, leadId, { dueAt, note }, new Date(Math.min(now.getTime(), dueAt.getTime()) - 60_000));
  });
}

