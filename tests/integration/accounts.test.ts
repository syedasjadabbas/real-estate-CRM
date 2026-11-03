import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount, linkableRecords, ownedLeadSummary, reassignOwnedLeads, resetAccountPassword, setAccountStatus, updateAccount } from "@/modules/accounts/service";
import { createEmployeeRecord, getEmployee, listEmployees } from "@/modules/employees/service";
import { createLead } from "@/modules/leads/commands";
import { authenticate } from "@/server/auth/login";
import { findActorByToken, loadActor } from "@/server/auth/session-store";
import { auditLogs, followUps, leads, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
};
const errorCode = async (p: Promise<unknown>) => (await errorOf(p))?.code ?? "ok";
const PASSWORD = "a-long-test-password";
let ipSeq = 0;
const signIn = (db: Database, email: string, password = PASSWORD) => authenticate(db, { email, password }, { ip: `10.9.0.${++ipSeq % 250}` });

describe.skipIf(!hasTestDb)("Account management (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [u] = await db.insert(users).values({ name: "Zed Admin", email: "admin@test.local", role: "admin", passwordHash: "x" }).returning();
    admin = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  });

  const create = (actor: Actor, overrides: Record<string, unknown> = {}) =>
    createAccount(db, actor, { name: "New Agent", email: "new.agent@test.local", role: "agent", password: PASSWORD, ...overrides });

  it("an admin creates an account that can sign in; the password is hashed and never audited", async () => {
    const { id } = await create(admin, { email: "  New.Agent@Test.local " });
    const [u] = await db.select().from(users).where(eq(users.id, id));
    expect(u).toMatchObject({ email: "new.agent@test.local", role: "agent", status: "active" });
    expect(u.passwordHash).not.toContain(PASSWORD);
    const { token } = await signIn(db, "new.agent@test.local");
    expect((await findActorByToken(db, token))?.id).toBe(id);
    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "user.create"), eq(auditLogs.entityId, id)));
    expect(JSON.stringify(log)).not.toContain(PASSWORD);
    expect(log.actorId).toBe(admin.id);
  });

  it("validates input: duplicate email, short password, password equal to email, unknown fields", async () => {
    await create(admin);
    expect((await errorOf(create(admin, { email: "NEW.AGENT@test.local" })))?.fields?.email).toMatch(/already exists/);
    expect((await errorOf(create(admin, { email: "x@test.local", password: "short" })))?.fields?.password).toMatch(/at least 10/);
    expect((await errorOf(create(admin, { email: "same.as.password@test.local", password: "same.as.password@test.local" })))?.fields?.password).toMatch(/email/);
    expect(await errorCode(create(admin, { email: "y@test.local", status: "inactive" }))).toBe("VALIDATION_FAILED");
  });

  it("only Admin and Super Admin manage accounts", async () => {
    for (const actor of [f.actors.manager, f.actors.agent1, f.actors.hr]) {
      expect(await errorCode(create(actor, { email: `${actor.role}.made@test.local` }))).toBe("FORBIDDEN");
      expect(await errorCode(setAccountStatus(db, actor, f.actors.agent2.id, { status: "inactive" }))).toBe("FORBIDDEN");
    }
  });

  it("an admin can't create, change, reset or deactivate a Super Admin account, or grant that role", async () => {
    const sa = f.actors.superAdmin.id;
    expect(await errorCode(create(admin, { role: "super_admin" }))).toBe("FORBIDDEN");
    expect(await errorCode(updateAccount(db, admin, sa, { name: "Renamed" }))).toBe("FORBIDDEN");
    expect(await errorCode(resetAccountPassword(db, admin, sa, { password: PASSWORD }))).toBe("FORBIDDEN");
    expect(await errorCode(setAccountStatus(db, admin, sa, { status: "inactive" }))).toBe("FORBIDDEN");
    expect(await errorCode(updateAccount(db, admin, f.actors.agent2.id, { role: "super_admin" }))).toBe("FORBIDDEN");
    // A Super Admin can.
    expect(await errorCode(create(f.actors.superAdmin, { role: "super_admin", email: "sa2@test.local" }))).toBe("ok");
  });

  it("deactivation ends the open session and blocks sign-in; reactivation restores it", async () => {
    const { id } = await create(admin);
    const { token } = await signIn(db, "new.agent@test.local");
    expect(await setAccountStatus(db, admin, id, { status: "inactive" })).toEqual({ changed: true });
    expect(await findActorByToken(db, token)).toBeNull();
    expect((await errorOf(signIn(db, "new.agent@test.local")))?.message).toBe("This account is inactive.");
    await setAccountStatus(db, admin, id, { status: "active" });
    expect((await findActorByToken(db, (await signIn(db, "new.agent@test.local")).token))?.id).toBe(id);
    const actions = (await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, id))).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(["user.create", "user.deactivate", "user.reactivate"]));
  });

  it("nobody can deactivate or demote themselves, and the last active Super Admin is protected", async () => {
    expect(await errorCode(setAccountStatus(db, admin, admin.id, { status: "inactive" }))).toBe("BUSINESS_RULE");
    expect(await errorCode(updateAccount(db, admin, admin.id, { role: "agent" }))).toBe("BUSINESS_RULE");
    const sa = f.actors.superAdmin;
    const { id: sa2 } = await create(sa, { role: "super_admin", email: "sa2@test.local" });
    const sa2Actor = await loadActor(db, { id: sa2, name: "New Agent", email: "sa2@test.local", role: "super_admin" });
    // Two active Super Admins: one may deactivate the other.
    expect(await errorCode(setAccountStatus(db, sa, sa2, { status: "inactive" }))).toBe("ok");
    // sa is now the only active one. Even a Super Admin actor other than sa (here the now-inactive
    // sa2, as defence in depth) can't demote or deactivate it.
    expect((await errorOf(updateAccount(db, sa2Actor, sa.id, { role: "admin" })))?.message).toMatch(/last active Super Admin/);
    expect((await errorOf(setAccountStatus(db, sa2Actor, sa.id, { status: "inactive" })))?.message).toMatch(/last active Super Admin/);
  });

  it("role changes respect team rules and end the user's sessions", async () => {
    expect((await errorOf(updateAccount(db, admin, f.actors.manager.id, { role: "agent" })))?.fields?.role).toMatch(/Manages/);
    expect((await errorOf(updateAccount(db, admin, f.actors.agent1.id, { role: "hr" })))?.fields?.role).toMatch(/Member of/);
    const { id } = await create(admin);
    const { token } = await signIn(db, "new.agent@test.local");
    expect(await updateAccount(db, admin, id, { role: "accountant" })).toEqual({ changed: ["role"] });
    expect(await findActorByToken(db, token)).toBeNull();
    expect(await updateAccount(db, admin, id, { name: "New Agent" })).toEqual({ changed: [] });
  });

  it("a password reset replaces the password and ends every session", async () => {
    const { id } = await create(admin);
    const { token } = await signIn(db, "new.agent@test.local");
    await resetAccountPassword(db, admin, id, { password: "another-long-password" });
    expect(await findActorByToken(db, token)).toBeNull();
    expect(await errorCode(signIn(db, "new.agent@test.local"))).toBe("UNAUTHENTICATED");
    expect(await errorCode(signIn(db, "new.agent@test.local", "another-long-password"))).toBe("ok");
  });

  it("the lead shift moves only the chosen groups, with pending follow-ups, through normal reassignment", async () => {
    const make = async (name: string) => {
      const r = await createLead(db, f.actors.manager, leadInput(f, { name, ownerId: f.actors.agent1.id }));
      if (r.outcome !== "created") throw new Error("lead");
      return r.leadId;
    };
    const open = await make("Open One");
    const lost = await make("Lost One");
    await db.update(leads).set({ stage: "lost_lead" }).where(eq(leads.id, lost));
    await db.insert(followUps).values({ leadId: open, assigneeId: f.actors.agent1.id, dueAt: new Date(Date.now() + 86_400_000), status: "pending", createdById: f.actors.manager.id });
    expect(await ownedLeadSummary(db, admin, f.actors.agent1.id)).toEqual({ open: 1, lost: 1, booked: 0 });

    expect(await errorCode(reassignOwnedLeads(db, admin, f.actors.agent1.id, { toUserId: f.actors.agent2.id }))).toBe("VALIDATION_FAILED");
    expect(await reassignOwnedLeads(db, admin, f.actors.agent1.id, { toUserId: f.actors.agent2.id, open: true })).toEqual({ moved: 1 });
    const owners = Object.fromEntries((await db.select({ id: leads.id, ownerId: leads.ownerId }).from(leads)).map((r) => [r.id, r.ownerId]));
    expect(owners[open]).toBe(f.actors.agent2.id);
    expect(owners[lost]).toBe(f.actors.agent1.id);
    const [fu] = await db.select().from(followUps).where(eq(followUps.leadId, open));
    expect(fu.assigneeId).toBe(f.actors.agent2.id);
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.action, "lead.assign"), eq(auditLogs.entityId, open)))).length).toBe(1);
    const [shift] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "user.leads_shift"), eq(auditLogs.entityId, f.actors.agent1.id)));
    expect(shift).toMatchObject({ actorId: admin.id, after: { toUserId: f.actors.agent2.id, moved: 1, matched: 1, open: true, lost: false, booked: false } });

    // The receiver must be an active agent or manager.
    expect(await errorCode(reassignOwnedLeads(db, admin, f.actors.agent1.id, { toUserId: f.actors.hr.id, lost: true }))).toBe("VALIDATION_FAILED");
    expect(await errorCode(reassignOwnedLeads(db, f.actors.manager, f.actors.agent1.id, { toUserId: f.actors.agent2.id, lost: true }))).toBe("FORBIDDEN");
  });

  it("Q1: a new account can be linked to an existing HR record, so the person is listed once with their history", async () => {
    const { id: recordId } = await createEmployeeRecord(db, f.actors.hr, { fullName: "Office Driver", email: "driver@test.local", department: "Logistics" });
    expect((await linkableRecords(db, admin)).map((r) => r.id)).toEqual([recordId]);
    const before = (await listEmployees(db, admin, {})).total;
    const { id } = await create(admin, { name: "Office Driver", email: "driver@test.local", employeeRecordId: recordId });
    const after = await listEmployees(db, admin, {});
    expect(after.total).toBe(before); // linked, not duplicated
    expect(after.rows.find((r) => r.id === id)).toMatchObject({ hasLogin: true, department: "Logistics" });
    const { history } = await getEmployee(db, admin, id);
    expect(history.length).toBeGreaterThanOrEqual(1); // the record's creation stays in the history
    expect(await linkableRecords(db, admin)).toEqual([]);
    // A record can't be linked twice.
    expect((await errorOf(create(admin, { email: "other@test.local", employeeRecordId: recordId })))?.fields?.employeeRecordId).toBeTruthy();
    expect((await db.select().from(users).where(eq(users.email, "other@test.local"))).length).toBe(0);
  });
});
