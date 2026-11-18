import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createEmployeeRecord } from "@/modules/employees/service";
import { hrExport } from "@/modules/hr/exports";
import { decideLeave, leaveBalances, leaveOverview, leavePeople, recordLeave } from "@/modules/leave/service";
import { loadActor } from "@/server/auth/session-store";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { appSettings, auditLogs, leaveRequests, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
};
const YEAR = new Date().getFullYear() + 1; // a whole year ahead, so nothing overlaps real dates

describe.skipIf(!hasTestDb)("Recording leave for someone (15 Nov 2026)", () => {
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
    // These tests check the two-step chain: set the earlier rules (HR, then Admin; HR's leave to a Super Admin; 30 days).
    await db.insert(appSettings).values([
      { key: "leave.annual_days", value: "30" },
      { key: "leave.staff_step1", value: "hr" },
      { key: "leave.staff_step2", value: "admin" },
      { key: "leave.hr_path", value: "senior" },
    ]);
    const [u] = await db.insert(users).values({ name: "Zed Admin", email: "admin@test.local", role: "admin", passwordHash: "x" }).returning();
    admin = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  });

  it("records leave for staff without a CRM login, counts it in their balance and lists it", async () => {
    const { id: recordId } = await createEmployeeRecord(db, f.actors.hr, { fullName: "Office Driver" });
    expect((await leavePeople(db, f.actors.hr)).map((p) => p.label)).toContain("Office Driver · No CRM login");

    expect((await errorOf(recordLeave(db, f.actors.agent1, { person: `record:${recordId}`, type: "annual", startDate: `${YEAR}-03-02`, endDate: `${YEAR}-03-03`, reason: "Sick" })))?.code).toBe("FORBIDDEN");
    expect((await errorOf(recordLeave(db, admin, { person: `record:${recordId}`, type: "annual", startDate: `${YEAR}-03-02`, endDate: `${YEAR}-03-03`, reason: "" })))?.fields?.reason).toMatch(/why/);
    // An Admin's entry for staff is approved at once.
    expect(await recordLeave(db, admin, { person: `record:${recordId}`, type: "medical", startDate: `${YEAR}-03-02`, endDate: `${YEAR}-03-03`, reason: "Phoned in sick" })).toMatchObject({ days: 2, status: "approved" });
    expect((await errorOf(recordLeave(db, admin, { person: `record:${recordId}`, type: "annual", startDate: `${YEAR}-03-03`, endDate: `${YEAR}-03-04`, reason: "Again" })))?.fields?.startDate).toMatch(/already has leave/);

    const balances = await leaveBalances(db, admin, YEAR);
    expect(balances.rows.find((r) => r.id === recordId)).toMatchObject({ name: "Office Driver", noLogin: true, granted: 2, medical: 2, remaining: 28 });
    const overview = await leaveOverview(db, admin, YEAR);
    expect(overview.rows.find((r) => r.employeeProfileId === recordId)).toMatchObject({ userName: "Office Driver", userRole: null, status: "approved" });
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "leave.record"));
    expect(log).toMatchObject({ actorId: admin.id });
    expect((await hrExport(db, admin, "leave", { year: String(YEAR) })).body).toContain("Office Driver,No CRM login,Medical (CPL)");
  });

  it("HR's entry for an agent waits for the normal approvals; nobody records their own leave", async () => {
    const r = await recordLeave(db, f.actors.hr, { person: `user:${f.actors.agent1.id}`, type: "annual", startDate: `${YEAR}-04-06`, endDate: `${YEAR}-04-06`, reason: "Phoned in sick" });
    expect(r.status).toBe("pending");
    const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, r.id));
    expect(row).toMatchObject({ userId: f.actors.agent1.id, recordedById: f.actors.hr.id, approvalPath: "staff", currentStep: 1 });
    // Step 1 by HR, step 2 by an Admin, as for any staff request.
    await decideLeave(db, f.actors.hr, r.id, { approve: true });
    expect(await decideLeave(db, admin, r.id, { approve: true })).toMatchObject({ status: "approved" });

    expect((await errorOf(recordLeave(db, admin, { person: `user:${admin.id}`, type: "annual", startDate: `${YEAR}-05-04`, endDate: `${YEAR}-05-04`, reason: "Me" })))?.fields?.person).toMatch(/My workplace/);
    // An Admin recording leave for HR (senior path) leaves it for a Super Admin.
    expect((await recordLeave(db, admin, { person: `user:${f.actors.hr.id}`, type: "annual", startDate: `${YEAR}-05-04`, endDate: `${YEAR}-05-04`, reason: "Family" })).status).toBe("pending");
  });
});
