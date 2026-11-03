import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import {
  cancelApprovedLeave,
  decideLeave,
  decideLeaveCancellation,
  leaveBalance,
  leaveOverview,
  myLeave,
  requestLeaveCancellation,
  submitLeave,
  updateLeaveSettings,
  withdrawLeave,
} from "@/modules/leave/service";
import { businessToday } from "@/modules/bookings/today";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, employeeProfiles, leads, leaveRequests, rosterEntries, teamMembers, users } from "@/server/db/schema";
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
const YEAR = Number(businessToday().slice(0, 4));
const d = (md: string) => `${YEAR}-${md}`;

describe.skipIf(!hasTestDb)("Leave (questionnaire Q4–Q19, PostgreSQL integration)", () => {
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

  const req = (actor: Actor, from: string, to: string, type = "annual") => submitLeave(db, actor, { type, startDate: d(from), endDate: d(to) });

  it("counts calendar days, takes medical leave from the annual allowance and blocks requests over the balance", async () => {
    const m = f.actors.manager;
    expect(await req(m, "03-06", "03-09")).toMatchObject({ days: 4 }); // Fri–Mon: calendar days (Q8)
    await req(m, "04-01", "04-10", "medical");
    expect(await leaveBalance(db, m.id, YEAR)).toMatchObject({ allowance: 30, granted: 0, pending: 14, remaining: 16 });
    // 17 days would exceed the 16 remaining (Q12); pending requests hold their days.
    expect((await errorOf(req(m, "05-01", "05-17")))?.fields?.endDate).toMatch(/only 16 remain/);
    expect(await errorCode(req(m, "05-01", "05-16"))).toBe("ok");
    expect((await leaveBalance(db, m.id, YEAR)).remaining).toBe(0);
  });

  it("allows past dates (Q16), refuses overlaps and requests across two calendar years (C-13 pending)", async () => {
    const m = f.actors.manager;
    expect(await errorCode(req(m, "01-02", "01-03"))).toBe("ok");
    expect((await errorOf(req(m, "01-03", "01-04")))?.fields?.startDate).toMatch(/already have leave/);
    const cross = await errorOf(submitLeave(db, m, { type: "annual", startDate: `${YEAR}-12-30`, endDate: `${YEAR + 1}-01-02` }));
    expect(cross?.fields?.endDate).toMatch(/two calendar years/);
    expect(await errorCode(submitLeave(db, m, { type: "annual", startDate: d("02-05"), endDate: d("02-04") }))).toBe("VALIDATION_FAILED");
  });

  it("prorates joiners from their joining date (Q13, provisional method)", async () => {
    await db.insert(employeeProfiles).values({ userId: f.actors.agent1.id, joiningDate: d("07-02") });
    expect(await leaveBalance(db, f.actors.agent1.id, YEAR)).toMatchObject({ prorated: true });
    const { allowance } = await leaveBalance(db, f.actors.agent1.id, YEAR);
    expect(allowance).toBeGreaterThan(14);
    expect(allowance).toBeLessThan(16);
  });

  it("Q7: a Super Admin approves managers' leave; admins can't; nobody approves their own; approval fills the roster without replacing set days", async () => {
    const m = f.actors.manager; // member of Team 1
    await db.insert(rosterEntries).values({ teamId: await teamOf(m.id), userId: m.id, date: d("06-02"), status: "in_office", setById: m.id });
    const { id } = await req(m, "06-01", "06-03");
    expect(await errorCode(decideLeave(db, admin, id, { approve: true }))).toBe("FORBIDDEN");
    expect(await errorCode(decideLeave(db, m, id, { approve: true }))).toBe("FORBIDDEN");
    expect(await decideLeave(db, f.actors.superAdmin, id, { approve: true })).toEqual({ status: "approved", rosterDays: 2 });
    const roster = await db.select().from(rosterEntries).where(eq(rosterEntries.userId, m.id));
    expect(roster.map((r) => [r.date, r.status, r.leaveRequestId === id]).sort()).toEqual([
      [d("06-01"), "on_leave", true],
      [d("06-02"), "in_office", false], // the manager's own entry is kept (C-14)
      [d("06-03"), "on_leave", true],
    ]);
    expect((await leaveBalance(db, m.id, YEAR)).granted).toBe(3);

    // A Super Admin's own leave needs another Super Admin (C-5 pending: no self-approval).
    const sa = f.actors.superAdmin;
    const own = await req(sa, "08-01", "08-01");
    expect((await errorOf(decideLeave(db, sa, own.id, { approve: true })))?.message).toMatch(/own leave/);
  });

  it("Q15: cancelling approved leave is decided by an Admin or Super Admin; the days return and only leave-written roster days go", async () => {
    const m = f.actors.manager;
    const { id } = await req(m, "06-10", "06-11");
    await decideLeave(db, f.actors.superAdmin, id, { approve: true });
    expect(await errorCode(requestLeaveCancellation(db, f.actors.agent1, id, { reason: "x" }))).toBe("NOT_FOUND");
    await requestLeaveCancellation(db, m, id, { reason: "Plans changed" });
    expect(await errorCode(decideLeaveCancellation(db, f.actors.hr, id, { approve: true }))).toBe("FORBIDDEN");
    expect(await decideLeaveCancellation(db, admin, id, { approve: true })).toEqual({ status: "cancelled", rosterDaysRemoved: 2 });
    expect((await leaveBalance(db, m.id, YEAR)).granted).toBe(0);
    expect(await db.select().from(rosterEntries).where(eq(rosterEntries.userId, m.id))).toEqual([]);

    // Direct cancellation by an admin, with a reason; never of one's own leave.
    const second = await req(m, "07-01", "07-01");
    await decideLeave(db, f.actors.superAdmin, second.id, { approve: true });
    expect(await errorCode(cancelApprovedLeave(db, f.actors.manager, second.id, { reason: "x" }))).toBe("FORBIDDEN");
    expect(await cancelApprovedLeave(db, admin, second.id, { reason: "Booked by mistake" })).toMatchObject({ status: "cancelled" });
    const actions = (await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entity, "leave_request"))).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(["leave.request", "leave.approve", "leave.cancel_request", "leave.cancel"]));
  });

  it("Q6: staff requests wait until both approval steps are set, then follow them in order", async () => {
    const a = f.actors.agent1;
    const { id } = await req(a, "09-01", "09-02");
    expect((await errorOf(decideLeave(db, f.actors.manager, id, { approve: true })))?.message).toMatch(/not set yet/);
    expect(await errorCode(updateLeaveSettings(db, f.actors.hr, { annualDays: 30, staffStep1: "team_manager", staffStep2: "hr" }))).toBe("FORBIDDEN");
    expect((await errorOf(updateLeaveSettings(db, admin, { annualDays: 30, staffStep1: "team_manager", staffStep2: null })))?.fields?.staffStep2).toMatch(/both/);
    await updateLeaveSettings(db, admin, { annualDays: 30, staffStep1: "team_manager", staffStep2: "hr" });

    // Step 1: only the agent's team manager; HR can't jump ahead.
    expect(await errorCode(decideLeave(db, f.actors.hr, id, { approve: true }))).toBe("FORBIDDEN");
    const [other] = await db.insert(users).values({ name: "Other Mgr", email: "om@test.local", role: "manager", passwordHash: "x" }).returning();
    expect(await errorCode(decideLeave(db, await loadActor(db, { id: other.id, name: other.name, email: other.email, role: "manager" }), id, { approve: true }))).toBe("FORBIDDEN");
    expect(await decideLeave(db, f.actors.manager, id, { approve: true })).toEqual({ status: "pending", nextStep: 2 });
    expect(await errorCode(decideLeave(db, f.actors.manager, id, { approve: true }))).toBe("FORBIDDEN");
    expect(await decideLeave(db, f.actors.hr, id, { approve: true })).toMatchObject({ status: "approved" });

    // A rejection at any step ends the request; its days return.
    const second = await req(a, "10-01", "10-01");
    expect(await decideLeave(db, f.actors.manager, second.id, { approve: false, comment: "Busy week" })).toEqual({ status: "rejected" });
    expect((await leaveBalance(db, a.id, YEAR)).pending).toBe(0);
  });

  it("withdrawal is the requester's own and only while pending", async () => {
    const { id } = await req(f.actors.manager, "11-20", "11-20");
    expect(await errorCode(withdrawLeave(db, f.actors.agent1, id))).toBe("NOT_FOUND");
    expect(await withdrawLeave(db, f.actors.manager, id)).toEqual({ status: "withdrawn" });
    expect(await errorCode(withdrawLeave(db, f.actors.manager, id))).toBe("BUSINESS_RULE");
    expect((await myLeave(db, f.actors.manager, YEAR)).rows.map((r) => r.status)).toEqual(["withdrawn"]);
  });

  it("Q19: automatic lead rotation skips agents on approved leave today", async () => {
    const today = businessToday();
    for (const agent of [f.actors.agent1, f.actors.outsideAgent]) {
      await db.insert(leaveRequests).values({ userId: agent.id, type: "annual", startDate: today, endDate: today, days: 1, status: "approved", approvalPath: "staff" });
    }
    for (let i = 0; i < 3; i++) {
      const r = await createLead(db, f.actors.superAdmin, leadInput(f, { ownerId: undefined }));
      if (r.outcome !== "created") throw new Error("lead");
      const [lead] = await db.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, r.leadId));
      expect(lead.ownerId).toBe(f.actors.agent2.id);
    }
  });

  it("visibility: HR, admins and super admins see all; managers their teams; others can't open the admin view", async () => {
    await req(f.actors.agent1, "09-10", "09-10");
    await req(f.actors.outsideAgent, "09-11", "09-11");
    expect((await leaveOverview(db, f.actors.hr, YEAR)).rows).toHaveLength(2);
    expect((await leaveOverview(db, f.actors.manager, YEAR)).rows.map((r) => r.userId)).toEqual([f.actors.agent1.id]);
    expect(await errorCode(leaveOverview(db, f.actors.agent1, YEAR))).toBe("FORBIDDEN");
    const [row] = await db.select().from(leaveRequests).where(and(eq(leaveRequests.userId, f.actors.agent1.id)));
    expect(row.approvalPath).toBe("staff");
  });

  async function teamOf(userId: string) {
    const [m] = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, userId)).limit(1);
    return m.teamId;
  }
});
