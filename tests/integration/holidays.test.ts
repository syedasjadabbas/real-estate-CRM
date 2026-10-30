import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { businessToday } from "@/modules/bookings/today";
import { createHoliday, deleteHoliday, listHolidays, updateHoliday } from "@/modules/holidays/service";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, holidays, users } from "@/server/db/schema";
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
const fieldsOf = async (p: Promise<unknown>) => (await errorOf(p))?.fields ?? {};

describe.skipIf(!hasTestDb)("Holidays (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;
  let accountant: Actor;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const mk = async (role: "admin" | "accountant", email: string) => {
      const [u] = await db.insert(users).values({ name: role, email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    admin = await mk("admin", "admin@test.local");
    accountant = await mk("accountant", "acc@test.local");
  });

  const company = (date: string, name = "Company Day") => ({ date, name, scope: "company" });
  const regional = (date: string, region: string, name = "Regional Day") => ({ date, name, scope: "regional", region });

  describe("permissions", () => {
    it("lets HR, admin and super admin create; denies managers, agents and accountants", async () => {
      expect(await errorCode(createHoliday(db, f.actors.hr, company("2026-12-25")))).toBe("ok");
      expect(await errorCode(createHoliday(db, admin, company("2026-12-26")))).toBe("ok");
      expect(await errorCode(createHoliday(db, f.actors.superAdmin, company("2026-12-27")))).toBe("ok");
      for (const actor of [f.actors.manager, f.actors.agent1, accountant]) {
        expect(await errorCode(createHoliday(db, actor, company("2026-12-28")))).toBe("FORBIDDEN");
      }
      expect(await db.select().from(holidays)).toHaveLength(3);
    });

    it("lets managers list read-only; denies agents and accountants", async () => {
      const { holidayId } = await createHoliday(db, f.actors.hr, company("2026-08-14", "Independence Day"));
      expect((await listHolidays(db, f.actors.manager, { year: "2026" })).rows.map((r) => r.name)).toEqual(["Independence Day"]);
      expect(await errorCode(listHolidays(db, f.actors.agent1, { year: "2026" }))).toBe("FORBIDDEN");
      expect(await errorCode(listHolidays(db, accountant, { year: "2026" }))).toBe("FORBIDDEN");
      expect(await errorCode(updateHoliday(db, f.actors.manager, holidayId, { name: "X Day" }))).toBe("FORBIDDEN");
      expect(await errorCode(deleteHoliday(db, f.actors.manager, holidayId))).toBe("FORBIDDEN");
      expect(await errorCode(deleteHoliday(db, f.actors.agent1, holidayId))).toBe("FORBIDDEN");
      expect(await db.select().from(holidays)).toHaveLength(1);
    });
  });

  describe("create / edit / delete", () => {
    it("creates with audit and stores the date unchanged (no time zone shift)", async () => {
      const { holidayId } = await createHoliday(db, f.actors.hr, { date: "2026-03-23", name: "  Pakistan   Day ", scope: "company" });
      const [row] = await db.select().from(holidays).where(eq(holidays.id, holidayId));
      expect(row).toMatchObject({ date: "2026-03-23", name: "Pakistan Day", scope: "company", region: null, createdById: f.actors.hr.id });
      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, holidayId));
      expect(log).toMatchObject({ action: "holiday.create", entity: "holiday", actorId: f.actors.hr.id });
    });

    it("rejects invalid input with field errors and writes nothing", async () => {
      expect(Object.keys(await fieldsOf(createHoliday(db, f.actors.hr, { date: "2026-02-30", name: "Bad" })))).toEqual(["date"]);
      expect(Object.keys(await fieldsOf(createHoliday(db, f.actors.hr, { date: "2026-02-01", name: "" })))).toEqual(["name"]);
      expect(Object.keys(await fieldsOf(createHoliday(db, f.actors.hr, { date: "2026-02-01", name: "Day", scope: "regional" })))).toEqual(["region"]);
      expect(Object.keys(await fieldsOf(createHoliday(db, f.actors.hr, { date: "2026-02-01", name: "Day", scope: "company", region: "Lahore" })))).toEqual(["region"]);
      expect(await db.select().from(holidays)).toHaveLength(0);
    });

    it("edits changed fields only, audits before / after, and can switch scope", async () => {
      const { holidayId } = await createHoliday(db, f.actors.hr, company("2026-09-06", "Defence Day"));
      expect((await updateHoliday(db, admin, holidayId, { name: "Defence Day" })).changed).toEqual([]);
      expect((await updateHoliday(db, admin, holidayId, { scope: "regional", region: "Lahore" })).changed).toEqual(["scope", "region"]);
      expect(await fieldsOf(updateHoliday(db, admin, holidayId, { scope: "company" }))).toEqual({ region: "Company-wide holidays have no region" });
      expect((await updateHoliday(db, admin, holidayId, { scope: "company", region: null, date: "2026-09-07" })).changed).toEqual(["date", "scope", "region"]);
      const [row] = await db.select().from(holidays).where(eq(holidays.id, holidayId));
      expect(row).toMatchObject({ date: "2026-09-07", scope: "company", region: null, updatedById: admin.id });
      const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "holiday.update"));
      expect(logs.map((l) => l.before)).toContainEqual({ scope: "company", region: null });
    });

    it("deletes with an audit snapshot; unknown or malformed ids are 404", async () => {
      const { holidayId } = await createHoliday(db, f.actors.hr, regional("2026-11-09", "Punjab", "Iqbal Day"));
      expect(await deleteHoliday(db, f.actors.hr, holidayId)).toEqual({ deleted: true });
      expect(await db.select().from(holidays)).toHaveLength(0);
      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "holiday.delete"));
      expect(log.before).toEqual({ date: "2026-11-09", name: "Iqbal Day", scope: "regional", region: "Punjab" });
      expect(await errorCode(deleteHoliday(db, f.actors.hr, holidayId))).toBe("NOT_FOUND");
      expect(await errorCode(updateHoliday(db, f.actors.hr, "not-an-id", { name: "Valid name" }))).toBe("NOT_FOUND");
    });
  });

  describe("duplicates", () => {
    it("blocks a second company-wide holiday on the same date", async () => {
      await createHoliday(db, f.actors.hr, company("2026-12-25", "Christmas"));
      expect(await fieldsOf(createHoliday(db, admin, company("2026-12-25", "Quaid Day")))).toEqual({ date: "A company-wide holiday already exists on this date" });
    });

    it("blocks the same region twice on a date (case-insensitive) but allows other regions and a company holiday", async () => {
      await createHoliday(db, f.actors.hr, regional("2026-11-09", "Punjab"));
      expect(await fieldsOf(createHoliday(db, f.actors.hr, regional("2026-11-09", "  punjab ")))).toEqual({ date: "This region already has a holiday on this date" });
      expect(await errorCode(createHoliday(db, f.actors.hr, regional("2026-11-09", "Sindh")))).toBe("ok");
      expect(await errorCode(createHoliday(db, f.actors.hr, company("2026-11-09")))).toBe("ok");
      expect(await errorCode(createHoliday(db, f.actors.hr, regional("2027-11-09", "Punjab")))).toBe("ok");
    });

    it("blocks an edit that would collide with another holiday", async () => {
      await createHoliday(db, f.actors.hr, company("2026-05-01", "Labour Day"));
      const { holidayId } = await createHoliday(db, f.actors.hr, company("2026-05-02", "Other"));
      expect(await fieldsOf(updateHoliday(db, f.actors.hr, holidayId, { date: "2026-05-01" }))).toEqual({ date: "A company-wide holiday already exists on this date" });
    });

    it("the unique index rejects concurrent duplicates (one wins)", async () => {
      const results = await Promise.allSettled([createHoliday(db, f.actors.hr, company("2026-06-01", "Alpha")), createHoliday(db, admin, company("2026-06-01", "Beta"))]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect((failed.reason as AppError).fields).toEqual({ date: "A company-wide holiday already exists on this date" });
      expect(await db.select().from(holidays)).toHaveLength(1);
    });
  });

  describe("listing", () => {
    beforeEach(async () => {
      await createHoliday(db, f.actors.hr, company("2026-01-01", "New Year"));
      await createHoliday(db, f.actors.hr, company("2026-12-31", "Year End"));
      await createHoliday(db, f.actors.hr, regional("2026-06-15", "Gilgit", "Shandur Festival"));
      await createHoliday(db, f.actors.hr, regional("2026-07-01", "gilgit", "Valley Day"));
      await createHoliday(db, f.actors.hr, company("2025-12-31", "Last Year"));
      await createHoliday(db, f.actors.hr, company("2027-01-01", "Next Year"));
    });

    it("limits to the calendar year, inclusive of 1 Jan and 31 Dec, with tiles", async () => {
      const r = await listHolidays(db, f.actors.hr, { year: "2026" });
      expect(r.rows.map((x) => x.name)).toEqual(["New Year", "Shandur Festival", "Valley Day", "Year End"]);
      expect(r.tiles).toMatchObject({ total: 4, company: 2, regional: 2 });
      expect(r.regions).toEqual(["Gilgit"]);
    });

    it("filters by scope, region (any spelling) and search, and sorts by name", async () => {
      expect((await listHolidays(db, f.actors.hr, { year: "2026", scope: "company" })).rows).toHaveLength(2);
      expect((await listHolidays(db, f.actors.hr, { year: "2026", region: "GILGIT" })).rows).toHaveLength(2);
      expect((await listHolidays(db, f.actors.hr, { year: "2026", q: "festival" })).rows.map((x) => x.name)).toEqual(["Shandur Festival"]);
      expect((await listHolidays(db, f.actors.hr, { year: "2026", q: "100%_" })).rows).toHaveLength(0);
      expect((await listHolidays(db, f.actors.hr, { year: "2026", sort: "name", dir: "desc" })).rows.map((x) => x.name)).toEqual([
        "Year End",
        "Valley Day",
        "Shandur Festival",
        "New Year",
      ]);
    });

    it("defaults to the current business year and ignores an invalid year", async () => {
      const year = Number(businessToday().slice(0, 4));
      expect((await listHolidays(db, f.actors.hr, {})).year).toBe(year);
      expect((await listHolidays(db, f.actors.hr, { year: "abc" })).year).toBe(year);
    });

    it("reports the next upcoming holiday regardless of filters", async () => {
      await createHoliday(db, f.actors.hr, company("2099-01-02", "Far Future"));
      const r = await listHolidays(db, f.actors.hr, { year: "2026", scope: "regional" });
      const today = businessToday();
      expect(r.next === null || r.next.date >= today).toBe(true);
      expect((await listHolidays(db, f.actors.hr, { year: "2099" })).next?.date).toBeDefined();
    });
  });

  it("enforces the region / scope rule in the database too", async () => {
    await expect(db.insert(holidays).values({ date: "2026-01-05", name: "Bad", scope: "regional", region: null })).rejects.toThrow();
    await expect(db.insert(holidays).values({ date: "2026-01-05", name: "Bad", scope: "company", region: "Lahore" })).rejects.toThrow();
    await expect(db.insert(holidays).values({ date: "2026-01-05", name: "  ", scope: "company" })).rejects.toThrow();
  });
});
