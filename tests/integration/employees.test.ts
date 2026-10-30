import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEmployee, listEmployees, saveEmployeeProfile } from "@/modules/employees/service";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, employeeProfiles, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
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
const errorCode = async (p: Promise<unknown>) => (await errorOf(p))?.code ?? "ok";

describe.skipIf(!hasTestDb)("Employee records (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;
  let accountant: Actor;
  let inactiveId: string;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const mk = async (role: "admin" | "accountant", email: string) => {
      const [u] = await db.insert(users).values({ name: role === "admin" ? "Zed Admin" : "Acc Ountant", email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    admin = await mk("admin", "admin@test.local");
    accountant = await mk("accountant", "acc@test.local");
    const [gone] = await db.insert(users).values({ name: "Former Agent", email: "former@test.local", role: "agent", status: "inactive", passwordHash: "x" }).returning();
    inactiveId = gone.id;
  });

  const profile = { designation: "Sales Agent", department: "Sales", phoneCountryCode: "+92", phoneNumber: "0300 1234567", joiningDate: "2026-11-15" };

  describe("permissions", () => {
    it("lets super admin, admin and HR edit; denies manager, agent and accountant", async () => {
      expect(await errorCode(saveEmployeeProfile(db, f.actors.hr, f.actors.agent1.id, profile))).toBe("ok");
      expect(await errorCode(saveEmployeeProfile(db, admin, f.actors.agent2.id, { department: "Sales" }))).toBe("ok");
      expect(await errorCode(saveEmployeeProfile(db, f.actors.superAdmin, f.actors.manager.id, { designation: "Team Lead" }))).toBe("ok");
      for (const actor of [f.actors.manager, f.actors.agent1, accountant]) {
        expect(await errorCode(saveEmployeeProfile(db, actor, f.actors.agent1.id, { designation: "Hacked" }))).toBe("FORBIDDEN");
      }
      // An agent cannot edit even their own profile.
      expect(await errorCode(saveEmployeeProfile(db, f.actors.agent1, f.actors.agent1.id, { designation: "Self" }))).toBe("FORBIDDEN");
      const [row] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.userId, f.actors.agent1.id));
      expect(row.designation).toBe("Sales Agent");
    });

    it("lets managers read the directory and profiles; denies agents and accountants", async () => {
      expect((await listEmployees(db, f.actors.manager, {})).total).toBe(9);
      expect((await getEmployee(db, f.actors.manager, f.actors.agent1.id)).employee.email).toBe("agent1@test.local");
      for (const actor of [f.actors.agent1, accountant]) {
        expect(await errorCode(listEmployees(db, actor, {}))).toBe("FORBIDDEN");
        expect(await errorCode(getEmployee(db, actor, f.actors.agent1.id))).toBe("FORBIDDEN");
      }
    });
  });

  describe("profile save", () => {
    it("creates on first save, audits, and stores the lead-style phone and the date unchanged", async () => {
      expect((await saveEmployeeProfile(db, f.actors.hr, f.actors.agent1.id, profile)).changed).toEqual(["designation", "department", "phoneCountryCode", "phoneNumber", "phoneE164", "joiningDate"]);
      const [row] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.userId, f.actors.agent1.id));
      expect(row).toMatchObject({ designation: "Sales Agent", department: "Sales", phoneCountryCode: "+92", phoneNumber: "3001234567", phoneE164: "+923001234567", joiningDate: "2026-11-15", updatedById: f.actors.hr.id });
      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, f.actors.agent1.id));
      expect(log).toMatchObject({ action: "employee.profile_create", entity: "employee_profile", actorId: f.actors.hr.id });
      expect((await getEmployee(db, f.actors.hr, f.actors.agent1.id)).employee.phone).toBe("+92 300 1234567");
    });

    it("updates only changed fields, can clear them, and records each change", async () => {
      await saveEmployeeProfile(db, f.actors.hr, f.actors.agent1.id, profile);
      expect((await saveEmployeeProfile(db, f.actors.hr, f.actors.agent1.id, profile)).changed).toEqual([]);
      expect((await saveEmployeeProfile(db, admin, f.actors.agent1.id, { department: "  Sales  ", designation: "Senior Agent" })).changed).toEqual(["designation"]);
      expect((await saveEmployeeProfile(db, admin, f.actors.agent1.id, { phoneNumber: "", joiningDate: "" })).changed).toEqual(["phoneCountryCode", "phoneNumber", "phoneE164", "joiningDate"]);
      const [row] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.userId, f.actors.agent1.id));
      expect(row).toMatchObject({ designation: "Senior Agent", phoneE164: null, phoneCountryCode: null, joiningDate: null });
      const { history } = await getEmployee(db, f.actors.hr, f.actors.agent1.id);
      expect(history).toHaveLength(3);
      expect(history[0].before).toMatchObject({ phoneE164: "+923001234567", joiningDate: "2026-11-15" });
    });

    it("never touches account data or sign-in", async () => {
      const [before] = await db.select().from(users).where(eq(users.id, f.actors.agent1.id));
      expect(await errorCode(saveEmployeeProfile(db, f.actors.hr, f.actors.agent1.id, { ...profile, role: "admin" }))).toBe("VALIDATION_FAILED");
      expect(await errorCode(saveEmployeeProfile(db, f.actors.hr, f.actors.agent1.id, { status: "inactive" }))).toBe("VALIDATION_FAILED");
      expect(await errorCode(saveEmployeeProfile(db, f.actors.hr, f.actors.agent1.id, { name: "New Name", email: "x@test.local" }))).toBe("VALIDATION_FAILED");
      await saveEmployeeProfile(db, f.actors.hr, f.actors.agent1.id, profile);
      const [after] = await db.select().from(users).where(eq(users.id, f.actors.agent1.id));
      expect(after).toEqual(before);
    });

    it("rejects invalid fields with field errors and writes nothing", async () => {
      const fields = async (input: Record<string, unknown>) => Object.keys((await errorOf(saveEmployeeProfile(db, f.actors.hr, f.actors.agent1.id, input)))?.fields ?? {});
      expect(await fields({ phoneCountryCode: "+92", phoneNumber: "123" })).toEqual(["phoneNumber"]);
      expect(await fields({ joiningDate: "2026-13-01" })).toEqual(["joiningDate"]);
      expect(await fields({ designation: "x".repeat(101) })).toEqual(["designation"]);
      expect(await db.select().from(employeeProfiles)).toHaveLength(0);
    });

    it("allows a profile for an inactive account; unknown and malformed ids are 404", async () => {
      expect(await errorCode(saveEmployeeProfile(db, f.actors.hr, inactiveId, { department: "Sales" }))).toBe("ok");
      expect(await errorCode(saveEmployeeProfile(db, f.actors.hr, "00000000-0000-4000-8000-000000000000", { department: "Sales" }))).toBe("NOT_FOUND");
      expect(await errorCode(getEmployee(db, f.actors.hr, "not-an-id"))).toBe("NOT_FOUND");
    });

    it("keeps one profile per account under concurrent first saves", async () => {
      const results = await Promise.allSettled([
        saveEmployeeProfile(db, f.actors.hr, f.actors.agent2.id, { department: "Sales" }),
        saveEmployeeProfile(db, admin, f.actors.agent2.id, { designation: "Agent" }),
      ]);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const rows = await db.select().from(employeeProfiles).where(eq(employeeProfiles.userId, f.actors.agent2.id));
      expect(rows).toHaveLength(1);
    });
  });

  describe("directory", () => {
    beforeEach(async () => {
      await saveEmployeeProfile(db, f.actors.hr, f.actors.agent1.id, profile);
      await saveEmployeeProfile(db, f.actors.hr, f.actors.agent2.id, { designation: "Sales Agent", department: "sales" });
      await saveEmployeeProfile(db, f.actors.hr, f.actors.hr.id, { designation: "HR Officer", department: "Human Resources", joiningDate: "2024-01-01" });
    });

    it("lists every CRM account with tiles, including those without a profile", async () => {
      const r = await listEmployees(db, f.actors.hr, {});
      expect(r.total).toBe(9);
      expect(r.tiles).toEqual({ accounts: 9, active: 8, inactive: 1, completed: 1 });
      expect(r.rows.find((x) => x.id === f.actors.manager.id)).toMatchObject({ designation: null, department: null, phone: null });
      expect(r.departments).toEqual(["Human Resources", "Sales"]);
    });

    it("filters by role, status, department (any case) and search", async () => {
      expect((await listEmployees(db, f.actors.hr, { role: "agent" })).total).toBe(4);
      expect((await listEmployees(db, f.actors.hr, { status: "inactive" })).rows.map((x) => x.name)).toEqual(["Former Agent"]);
      expect((await listEmployees(db, f.actors.hr, { department: "SALES" })).total).toBe(2);
      expect((await listEmployees(db, f.actors.hr, { q: "officer" })).rows.map((x) => x.id)).toEqual([f.actors.hr.id]);
      expect((await listEmployees(db, f.actors.hr, { q: "agent1@" })).total).toBe(1);
      expect((await listEmployees(db, f.actors.hr, { q: "%" })).total).toBe(0);
    });

    it("sorts with blanks last and paginates", async () => {
      const byJoin = await listEmployees(db, f.actors.hr, { sort: "joiningDate", dir: "asc" });
      expect(byJoin.rows.slice(0, 2).map((x) => x.joiningDate)).toEqual(["2024-01-01", "2026-11-15"]);
      expect(byJoin.rows.at(-1)?.joiningDate).toBeNull();
      const byName = await listEmployees(db, f.actors.hr, { sort: "name", dir: "desc" });
      expect(byName.rows[0].name).toBe("Zed Admin");
      expect((await listEmployees(db, f.actors.hr, { page: "99" })).page).toBe(1);
    });
  });

  it("enforces the phone and length rules in the database too", async () => {
    await expect(db.insert(employeeProfiles).values({ userId: f.actors.agent1.id, phoneE164: "+923001234567" })).rejects.toThrow();
    await expect(db.insert(employeeProfiles).values({ userId: f.actors.agent1.id, phoneCountryCode: "+92", phoneNumber: "300", phoneE164: "300" })).rejects.toThrow();
    await expect(db.insert(employeeProfiles).values({ userId: f.actors.agent1.id, department: "x".repeat(101) })).rejects.toThrow();
    await db.insert(employeeProfiles).values({ userId: f.actors.agent1.id });
    await expect(db.insert(employeeProfiles).values({ userId: f.actors.agent1.id })).rejects.toThrow();
  });
});
