import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import {
  cancelApprovedLeave,
  decideLeave,
  decideLeaveCancellation,
  employeeLeaveBalance,
  leaveBalance,
  leaveBalances,
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

  it("allows past dates (Q16) and refuses overlaps", async () => {
    const m = f.actors.manager;
    expect(await errorCode(req(m, "01-02", "01-03"))).toBe("ok");
    expect((await errorOf(req(m, "01-03", "01-04")))?.fields?.startDate).toMatch(/already have leave/);
    expect(await errorCode(submitLeave(db, m, { type: "annual", startDate: d("02-05"), endDate: d("02-04") }))).toBe("VALIDATION_FAILED");
  });

  it("Q17: a request across two calendar years is recorded but held: not counted in either year and not approvable", async () => {
    const m = f.actors.manager;
    const held = await submitLeave(db, m, { type: "annual", startDate: `${YEAR}-12-29`, endDate: `${YEAR + 1}-01-03` });
    expect(held).toMatchObject({ days: 6, held: true });
    expect(await leaveBalance(db, m.id, YEAR)).toMatchObject({ granted: 0, pending: 0, remaining: 30 });
    expect(await leaveBalance(db, m.id, YEAR + 1)).toMatchObject({ granted: 0, pending: 0, remaining: 30 });
    expect((await errorOf(decideLeave(db, f.actors.superAdmin, held.id, { approve: true })))?.message).toMatch(/two calendar years/);
    expect((await leaveOverview(db, f.actors.superAdmin, YEAR)).decidable).toEqual([]);
    // It still blocks overlapping days, and it can be withdrawn.
    expect((await errorOf(req(m, "12-30", "12-31")))?.fields?.startDate).toMatch(/already have leave/);
    expect(await withdrawLeave(db, m, held.id)).toEqual({ status: "withdrawn" });
  });

  it("prorates joiners from their joining date (Q13, provisional method)", async () => {
    await db.insert(employeeProfiles).values({ userId: f.actors.agent1.id, joiningDate: d("07-02") });
    expect(await leaveBalance(db, f.actors.agent1.id, YEAR)).toMatchObject({ prorated: true, provisional: true });
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

  it("leave balances: HR sees everyone's; managers their team's; others are refused", async () => {
    await req(f.actors.agent1, "09-01", "09-03");
    const all = await leaveBalances(db, f.actors.hr, YEAR);
    expect(all.rows.find((r) => r.id === f.actors.agent1.id)).toMatchObject({ allowance: 30, pending: 3, remaining: 27 });
    expect(all.rows.length).toBeGreaterThanOrEqual(6);
    const team = await leaveBalances(db, f.actors.manager, YEAR);
    expect(team.rows.map((r) => r.id).sort()).toEqual([f.actors.manager.id, f.actors.agent1.id, f.actors.agent2.id].sort());
    expect(await errorCode(leaveBalances(db, f.actors.agent1, YEAR))).toBe("FORBIDDEN");
    expect(await employeeLeaveBalance(db, f.actors.manager, f.actors.agent1.id, YEAR)).toMatchObject({ remaining: 27 });
    expect(await errorCode(employeeLeaveBalance(db, f.actors.manager, f.actors.outsideAgent.id, YEAR))).toBe("FORBIDDEN");
  });

  describe("HR → Leave list: filters, sorting, paging and years (HR_MODULE_PLAN, FR-005)", () => {
    /** Rows straight into the table (no balance rules needed for list behaviour). */
    const seedRows = async (userId: string, n: number, year: number, extra: Partial<typeof leaveRequests.$inferInsert> = {}) =>
      db.insert(leaveRequests).values(
        Array.from({ length: n }, (_, i) => {
          const day = `${year}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`;
          return { userId, type: i % 3 === 0 ? ("medical" as const) : ("annual" as const), startDate: day, endDate: day, days: 1, approvalPath: "staff", status: "rejected" as const, ...extra };
        }),
      );

    it("pages 50 at a time with a total, and filters by status, type and search", async () => {
      await seedRows(f.actors.agent1.id, 55, YEAR);
      await seedRows(f.actors.agent2.id, 3, YEAR, { status: "approved", reason: "Family wedding" });
      const first = await leaveOverview(db, f.actors.hr, YEAR);
      expect(first).toMatchObject({ total: 58, page: 1, pageCount: 2 });
      expect(first.rows).toHaveLength(50);
      const second = await leaveOverview(db, f.actors.hr, YEAR, { page: "2" });
      expect(second.rows).toHaveLength(8);
      expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(58);

      expect((await leaveOverview(db, f.actors.hr, YEAR, { status: "approved" })).total).toBe(3);
      expect((await leaveOverview(db, f.actors.hr, YEAR, { type: "medical" })).rows.every((r) => r.type === "medical")).toBe(true);
      expect((await leaveOverview(db, f.actors.hr, YEAR, { q: "wedding" })).total).toBe(3);
      expect((await leaveOverview(db, f.actors.hr, YEAR, { q: f.actors.agent2.name })).total).toBe(3);
      // Unknown values are ignored, not errors.
      expect((await leaveOverview(db, f.actors.hr, YEAR, { status: "bogus", type: "x", sort: "nope" })).total).toBe(58);
      // A manager's filters stay inside their teams.
      expect((await leaveOverview(db, f.actors.manager, YEAR, { q: f.actors.outsideAgent.name })).total).toBe(0);
    });

    it("sorts by employee, dates, type, status and request time in both directions", async () => {
      await seedRows(f.actors.agent1.id, 4, YEAR);
      await seedRows(f.actors.agent2.id, 2, YEAR, { status: "approved" });
      const names = async (dir: string) => (await leaveOverview(db, f.actors.hr, YEAR, { sort: "employee", dir })).rows.map((r) => r.userName.toLowerCase());
      const asc = await names("asc");
      expect(asc).toEqual([...asc].sort());
      expect(await names("desc")).toEqual([...asc].reverse());
      const dates = (await leaveOverview(db, f.actors.hr, YEAR, { sort: "dates", dir: "asc" })).rows.map((r) => r.startDate);
      expect(dates).toEqual([...dates].sort());
      const statuses = (await leaveOverview(db, f.actors.hr, YEAR, { sort: "status", dir: "asc" })).rows.map((r) => r.status);
      expect(statuses).toEqual([...statuses].sort());
    });

    it("another year is listed on request; pending decisions from any year still reach the approver", async () => {
      await seedRows(f.actors.agent1.id, 2, YEAR - 1, { status: "approved" });
      // A manager's request from last year still waiting for the Super Admin (senior path).
      const [old] = await db
        .insert(leaveRequests)
        .values({ userId: f.actors.manager.id, type: "annual", startDate: `${YEAR - 1}-12-01`, endDate: `${YEAR - 1}-12-02`, days: 2, approvalPath: "senior", status: "pending" })
        .returning();
      const thisYear = await leaveOverview(db, f.actors.superAdmin, YEAR);
      expect(thisYear.total).toBe(0);
      expect(thisYear.years).toEqual([YEAR, YEAR - 1]);
      expect(thisYear.decidable.map((r) => r.id)).toEqual([old.id]);
      // Filters never hide a pending decision.
      expect((await leaveOverview(db, f.actors.superAdmin, YEAR, { status: "cancelled" })).decidable.map((r) => r.id)).toEqual([old.id]);
      expect((await leaveOverview(db, f.actors.superAdmin, YEAR - 1)).total).toBe(3);
    });

    it("My leave lists one year at a time and the years the person has requests in", async () => {
      await seedRows(f.actors.agent1.id, 2, YEAR - 2, { status: "approved" });
      await req(f.actors.agent1, "06-01", "06-02");
      const now = await myLeave(db, f.actors.agent1);
      expect(now).toMatchObject({ year: YEAR, years: [YEAR, YEAR - 2] });
      expect(now.rows).toHaveLength(1);
      const past = await myLeave(db, f.actors.agent1, YEAR - 2);
      expect(past.rows).toHaveLength(2);
      expect(past.balance.year).toBe(YEAR - 2);
      // Another person's years are not mixed in.
      expect((await myLeave(db, f.actors.agent2)).years).toEqual([YEAR]);
    });
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
