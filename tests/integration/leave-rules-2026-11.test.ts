import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decideLeave, getLeaveSettings, leaveBalance, submitLeave, updateLeaveSettings } from "@/modules/leave/service";
import { loadActor } from "@/server/auth/session-store";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { leaveRequests, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { eq } from "drizzle-orm";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

/**
 * The client's leave rules (owner, 18 Nov 2026): 12 days a year; staff leave (agents, accountants,
 * HR) approved by an Admin in one step; Admins' leave by a Super Admin. Admins and Super Admins can
 * change every rule at any time.
 */
describe.skipIf(!hasTestDb)("Leave rules of 18 Nov 2026 (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;
  let admin2: Actor;
  const year = new Date().getFullYear() + 1;
  const day = (md: string) => `${year}-${md}`;
  const statusOf = async (id: string) => (await db.select({ s: leaveRequests.status }).from(leaveRequests).where(eq(leaveRequests.id, id)))[0].s;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [a, b] = await db
      .insert(users)
      .values([
        { name: "Zed Admin", email: "admin@test.local", role: "admin", passwordHash: "x" },
        { name: "Yan Admin", email: "admin2@test.local", role: "admin", passwordHash: "x" },
      ])
      .returning();
    admin = await loadActor(db, { id: a.id, name: a.name, email: a.email, role: a.role });
    admin2 = await loadActor(db, { id: b.id, name: b.name, email: b.email, role: b.role });
  });

  it("defaults: 12 days, staff and HR leave approved by one Admin", async () => {
    expect(await getLeaveSettings(db)).toMatchObject({ annualDays: 12, staffStep1: "admin", staffStep2: "none", hrPath: "staff" });
    expect((await leaveBalance(db, f.actors.agent1.id, year)).allowance).toBe(12);

    const agentLeave = await submitLeave(db, f.actors.agent1, { type: "annual", startDate: day("03-02"), endDate: day("03-03"), reason: "Family" });
    expect(await code(decideLeave(db, f.actors.hr, agentLeave.id, { approve: true }))).toBe("FORBIDDEN");
    await decideLeave(db, admin, agentLeave.id, { approve: true });
    expect(await statusOf(agentLeave.id)).toBe("approved");

    const hrLeave = await submitLeave(db, f.actors.hr, { type: "annual", startDate: day("04-06"), endDate: day("04-06"), reason: "Errand" });
    await decideLeave(db, admin, hrLeave.id, { approve: true });
    expect(await statusOf(hrLeave.id)).toBe("approved");
  });

  it("an Admin's leave goes to a Super Admin, not another Admin", async () => {
    const r = await submitLeave(db, admin, { type: "annual", startDate: day("05-04"), endDate: day("05-04"), reason: "Trip" });
    expect(await code(decideLeave(db, admin2, r.id, { approve: true }))).toBe("FORBIDDEN");
    await decideLeave(db, f.actors.superAdmin, r.id, { approve: true });
    expect(await statusOf(r.id)).toBe("approved");
  });

  it("Admins can change the rules any time: allowance, a second step, and where HR's leave goes", async () => {
    expect(await code(updateLeaveSettings(db, f.actors.hr, { annualDays: 14 }))).toBe("FORBIDDEN");
    await updateLeaveSettings(db, admin, { annualDays: 14, staffStep1: "hr", staffStep2: "admin", hrPath: "senior" });
    expect(await getLeaveSettings(db)).toMatchObject({ annualDays: 14, staffStep1: "hr", staffStep2: "admin", hrPath: "senior" });
    expect((await leaveBalance(db, f.actors.agent1.id, year)).allowance).toBe(14);

    const r = await submitLeave(db, f.actors.agent1, { type: "annual", startDate: day("06-01"), endDate: day("06-01"), reason: "Doctor" });
    await decideLeave(db, f.actors.hr, r.id, { approve: true });
    expect(await statusOf(r.id)).toBe("pending");
    await decideLeave(db, admin, r.id, { approve: true });
    expect(await statusOf(r.id)).toBe("approved");

    const hrLeave = await submitLeave(db, f.actors.hr, { type: "annual", startDate: day("07-01"), endDate: day("07-01"), reason: "Errand" });
    expect(await code(decideLeave(db, admin, hrLeave.id, { approve: true }))).toBe("FORBIDDEN");
    await decideLeave(db, f.actors.superAdmin, hrLeave.id, { approve: true });
    expect(await statusOf(hrLeave.id)).toBe("approved");
  });
});
