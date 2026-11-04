import { and, asc, eq, like } from "drizzle-orm";
import { advanceBooking, cancelBooking, createBooking } from "@/modules/bookings/commands";
import { convertLeadToClient } from "@/modules/clients/commands";
import { recordPayment } from "@/modules/finance/commands";
import { listPaymentMethods } from "@/modules/finance/queries";
import { createUnit } from "@/modules/inventory/commands";
import { createLead, scheduleFollowUp } from "@/modules/leads/commands";
import { getLeaveSettings, updateLeaveSettings } from "@/modules/leave/service";
import { createTeam, setTeamMembers } from "@/modules/teams/commands";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, bookingPayments, bookings, financeCategories, financeEntries, leads, leaveDecisions, projects, teams, units, users } from "@/server/db/schema";
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

/** A lead's code and stored (normalized) phone. */
export function leadPhone(leadId: string) {
  return withDb(async (db) => (await db.select({ code: leads.code, phoneE164: leads.phoneE164, phoneNumber: leads.phoneNumber }).from(leads).where(eq(leads.id, leadId)))[0]);
}


/** Sets (or, with nulls, clears) the two staff leave approval steps through the real service, as the Admin. */
export function setStaffLeaveSteps(staffStep1: string | null, staffStep2: string | null) {
  return withDb(async (db) => updateLeaveSettings(db, await actorOf(db, "admin"), { annualDays: (await getLeaveSettings(db)).annualDays, staffStep1, staffStep2 }));
}

/** Approval decisions on a leave request, step order. */
export function leaveApprovals(requestId: string) {
  return withDb(async (db) =>
    db.select({ step: leaveDecisions.step, actorId: leaveDecisions.actorId, approved: leaveDecisions.approved }).from(leaveDecisions).where(and(eq(leaveDecisions.requestId, requestId), eq(leaveDecisions.kind, "approval"))).orderBy(asc(leaveDecisions.step)),
  );
}

/** `count` inactive projects named `<prefix> 000…` (inactive: kept out of the project selector for other tests). */
export function seedProjects(prefix: string, count: number) {
  return withDb(async (db) => {
    await db.insert(projects).values(Array.from({ length: count }, (_, i) => ({ name: `${prefix} ${String(i).padStart(3, "0")}`, status: "inactive" as const })));
  });
}

/** `count` inactive teams named `<prefix> 000…`. */
export function seedTeams(prefix: string, count: number) {
  return withDb(async (db) => {
    await db.insert(teams).values(Array.from({ length: count }, (_, i) => ({ name: `${prefix} ${String(i).padStart(3, "0")}`, isActive: false })));
  });
}

/** Removes what `seedProjects` / `seedTeams` added to the test database, so later specs see the usual lists. */
export function removeSeededLists(prefix: string) {
  return withDb(async (db) => {
    await db.delete(projects).where(like(projects.name, `${prefix} %`));
    await db.delete(teams).where(like(teams.name, `${prefix} %`));
  });
}

/** Makes the lead's client now (through the real service), as a manager's "Convert to client" does. */
export function convertLeadFor(leadId: string) {
  return withDb(async (db) => (await convertLeadToClient(db, await actorOf(db, "manager"), { leadId })).clientId);
}

/** Moves a new booking to Token pending and records its token in cash, as the Accountant. Dated last year: other specs count this month's receipts. */
export function payTokenFor(bookingId: string, amount: string) {
  return withDb(async (db) => {
    await advanceBooking(db, await actorOf(db, "manager"), bookingId, { toStage: "token_pending" });
    const methodId = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash")!.id;
    const lastYear = `${Number(seed().today.slice(0, 4)) - 1}-12-31`;
    await recordPayment(db, await actorOf(db, "accountant"), { bookingId, type: "token", amount, receivedOn: lastYear, methodId });
  });
}

export function cancelBookingFor(bookingId: string) {
  return withDb(async (db) => cancelBooking(db, await actorOf(db, "manager"), bookingId, { reason: "Buyer chose another unit" }));
}

export function leadOwnerId(leadId: string) {
  return withDb(async (db) => (await db.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, leadId)))[0].ownerId);
}

export function userIdByEmail(email: string) {
  return withDb(async (db) => (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id);
}

/** An expense category and one entry per amount, dated last year so other specs' current totals don't change. */
export function seedEntriesFor(categoryName: string, amounts: string[]) {
  return withDb(async (db) => {
    const [category] = await db.insert(financeCategories).values({ kind: "expense", name: categoryName }).returning({ id: financeCategories.id });
    const entryDate = `${Number(seed().today.slice(0, 4)) - 1}-06-15`;
    await db.insert(financeEntries).values(amounts.map((amount) => ({ kind: "expense" as const, categoryId: category.id, amount: Number(amount), entryDate, createdById: seed().users.accountant.id })));
  });
}
