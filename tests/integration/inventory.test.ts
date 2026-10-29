import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUnit, setUnitStatus, updateUnit } from "@/modules/inventory/commands";
import { getUnitDetail, listUnits } from "@/modules/inventory/queries";
import { reserveAvailableUnit } from "@/modules/inventory/status";
import { updateProjectDimensions } from "@/modules/projects/commands";
import { getProjectDetail, listProjects } from "@/modules/projects/queries";
import { hashPassword } from "@/server/auth/password";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, units, users } from "@/server/db/schema";
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

describe.skipIf(!hasTestDb)("Inventory module (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let accountant: Actor;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [u] = await db
      .insert(users)
      .values({ name: "Accountant", email: "acc@test.local", role: "accountant", passwordHash: await hashPassword("x-y-z-w-v") })
      .returning();
    accountant = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  });

  const unit = (overrides: Record<string, unknown> = {}) =>
    createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "A-101", areaSqft: "674", basePrice: "12500000", ...overrides });

  describe("create and edit", () => {
    it("creates an Available unit linked to its project, with an audit entry", async () => {
      const { unitId } = await unit({ floor: "2nd Floor", saleModel: "spu", bedrooms: "2", nature: "Apartment", listedOn: "2026-10-29" });
      const detail = await getUnitDetail(db, f.actors.agent1, unitId);
      expect(detail.unit).toMatchObject({
        projectName: "Test Project",
        unitNo: "A-101",
        status: "available",
        saleModel: "spu",
        areaSqft: 674,
        basePrice: 12_500_000,
        bedrooms: 2,
        listedOn: "2026-10-29",
      });
      expect(detail.history.map((h) => h.action)).toEqual(["unit.create"]);
      expect(detail.permissions.manage).toBe(false);
      expect((await getProjectDetail(db, f.actors.agent1, f.projectId)).links.unitsTracked).toBe(1);
      expect((await listProjects(db, f.actors.agent1, {})).kpis.unitsTracked).toBe(1);
    });

    it("rejects invalid input, unknown projects and duplicate unit numbers per project (ignoring case)", async () => {
      const bad = await errorOf(unit({ unitNo: "", areaSqft: "-5", basePrice: "abc" }));
      expect(bad?.code).toBe("VALIDATION_FAILED");
      expect(Object.keys(bad?.fields ?? {})).toEqual(expect.arrayContaining(["unitNo", "areaSqft", "basePrice"]));
      expect(await errorCode(unit({ projectId: "00000000-0000-4000-8000-000000000000" }))).toBe("VALIDATION_FAILED");

      await unit();
      const dup = await errorOf(unit({ unitNo: "a-101" }));
      expect(dup?.code).toBe("CONFLICT");
      expect(dup?.fields).toHaveProperty("unitNo");
      expect(await errorCode(unit({ projectId: f.otherProjectId }))).toBe("ok");
    });

    it("applies partial edits with before/after audit and keeps unit numbers unique on rename", async () => {
      const { unitId } = await unit({ comment: "Corner" });
      await unit({ unitNo: "A-102" });
      expect(await updateUnit(db, f.actors.superAdmin, unitId, { basePrice: "13,000,000", comment: "" })).toEqual({
        changed: ["basePrice", "comment"],
      });
      expect(await updateUnit(db, f.actors.superAdmin, unitId, { basePrice: "13000000" })).toEqual({ changed: [] });
      expect(await errorCode(updateUnit(db, f.actors.superAdmin, unitId, { unitNo: "A-102" }))).toBe("CONFLICT");

      const [row] = await db.select().from(units).where(eq(units.id, unitId));
      expect(row).toMatchObject({ basePrice: 13_000_000, comment: null });
      const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, unitId), eq(auditLogs.action, "unit.update")));
      expect(audit).toMatchObject({ before: { basePrice: 12_500_000, comment: "Corner" }, after: { basePrice: 13_000_000, comment: null } });
    });

    it("lets only admins create, edit or change status; HR cannot view", async () => {
      const { unitId } = await unit();
      for (const actor of [f.actors.manager, f.actors.agent1, accountant, f.actors.hr]) {
        expect(await errorCode(createUnit(db, actor, { projectId: f.projectId, unitNo: "X", areaSqft: "1", basePrice: "1" }))).toBe("FORBIDDEN");
        expect(await errorCode(updateUnit(db, actor, unitId, { comment: "x" }))).toBe("FORBIDDEN");
        expect(await errorCode(setUnitStatus(db, actor, unitId, { status: "sold", reason: "test" }))).toBe("FORBIDDEN");
      }
      expect(await errorCode(listUnits(db, f.actors.hr, {}, f.projectId))).toBe("FORBIDDEN");
      expect(await errorCode(getUnitDetail(db, f.actors.hr, unitId))).toBe("FORBIDDEN");
      expect((await listUnits(db, accountant, {}, f.projectId)).total).toBe(1);
    });
  });

  describe("project dimensions (FR-061)", () => {
    it("restricts dimension fields to the project's lists, matching case, and allows free text when a list is empty", async () => {
      await updateProjectDimensions(db, f.actors.superAdmin, f.projectId, { floors: ["Ground", "1st Floor"], categories: ["Corner"] });
      const bad = await errorOf(unit({ floor: "Roof", category: "Corner" }));
      expect(bad?.fields).toEqual({ floor: "Choose a value defined for this project" });

      const { unitId } = await unit({ floor: "ground", category: "corner", type: "Studio" });
      const [row] = await db.select().from(units).where(eq(units.id, unitId));
      expect(row).toMatchObject({ floor: "Ground", category: "Corner", type: "Studio" });

      // Removing a value keeps existing units valid; only changed fields are re-checked.
      await updateProjectDimensions(db, f.actors.superAdmin, f.projectId, { floors: ["1st Floor"] });
      expect(await updateUnit(db, f.actors.superAdmin, unitId, { comment: "still editable" })).toEqual({ changed: ["comment"] });
      expect(await errorCode(updateUnit(db, f.actors.superAdmin, unitId, { floor: "Ground" }))).toBe("ok");
      expect(await errorCode(updateUnit(db, f.actors.superAdmin, unitId, { floor: "Basement" }))).toBe("VALIDATION_FAILED");
      expect(await errorCode(updateProjectDimensions(db, f.actors.manager, f.projectId, { floors: [] }))).toBe("FORBIDDEN");
    });
  });

  describe("status", () => {
    it("records admin overrides with a reason and blocks invalid ones", async () => {
      const whole = (await unit()).unitId;
      const spu = (await unit({ unitNo: "S-1", saleModel: "spu" })).unitId;

      expect(await setUnitStatus(db, f.actors.superAdmin, whole, { status: "sold", reason: "Sold in SaleStorm" })).toEqual({ from: "available", to: "sold" });
      expect(await errorCode(setUnitStatus(db, f.actors.superAdmin, whole, { status: "sold", reason: "again" }))).toBe("BUSINESS_RULE");
      expect(await errorCode(setUnitStatus(db, f.actors.superAdmin, whole, { status: "partially_booked", reason: "x y z" }))).toBe("BUSINESS_RULE");
      expect(await errorCode(setUnitStatus(db, f.actors.superAdmin, whole, { status: "available", reason: "" }))).toBe("VALIDATION_FAILED");
      await setUnitStatus(db, f.actors.superAdmin, spu, { status: "partially_booked", reason: "Two strips sold" });
      expect(await errorCode(updateUnit(db, f.actors.superAdmin, spu, { saleModel: "whole" }))).toBe("BUSINESS_RULE");

      const history = (await getUnitDetail(db, f.actors.agent1, whole)).history;
      expect(history[0]).toMatchObject({
        action: "unit.status",
        before: { status: "available" },
        after: { status: "sold", source: "manual", reason: "Sold in SaleStorm" },
      });
    });

    it("enforces 'partially booked only for split units' in the database too", async () => {
      const { unitId } = await unit();
      await expect(db.update(units).set({ status: "partially_booked" }).where(eq(units.id, unitId))).rejects.toThrow();
    });

    it("lets exactly one of two concurrent reservations claim an Available unit", async () => {
      const { unitId } = await unit();
      const attempt = (who: Actor) => db.transaction((tx) => reserveAvailableUnit(tx, unitId, who.id, "booking test"));
      const results = await Promise.allSettled([attempt(f.actors.superAdmin), attempt(f.actors.manager)]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect((rejected.reason as AppError).code).toBe("CONFLICT");
      const [row] = await db.select().from(units).where(eq(units.id, unitId));
      expect(row.status).toBe("reserved");
      const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, unitId), eq(auditLogs.action, "unit.status")));
      expect(audits).toHaveLength(1);
    });

    it("does not reserve SPU or 50% units whole while their rules are unconfirmed", async () => {
      const { unitId } = await unit({ saleModel: "fractional_50" });
      expect(await errorCode(db.transaction((tx) => reserveAvailableUnit(tx, unitId, f.actors.superAdmin.id, "x")))).toBe("BUSINESS_RULE");
    });
  });

  describe("list", () => {
    it("filters by project (header default or all), search, status, sale model and nature", async () => {
      await unit({ floor: "Ground", nature: "Apartment" });
      await unit({ unitNo: "B-201", saleModel: "spu", nature: "Shop", comment: "Facing park" });
      await unit({ unitNo: "C-1", projectId: f.otherProjectId, nature: "Apartment" });
      const { unitId } = await unit({ unitNo: "A-102" });
      await setUnitStatus(db, f.actors.superAdmin, unitId, { status: "reserved", reason: "Held" });

      const nos = async (q: Record<string, string>) => (await listUnits(db, f.actors.agent1, q, f.projectId)).rows.map((r) => r.unitNo);
      expect(await nos({})).toEqual(["A-101", "A-102", "B-201"]);
      expect(await nos({ project: "all" })).toHaveLength(4);
      expect(await nos({ project: f.otherProjectId })).toEqual(["C-1"]);
      expect(await nos({ q: "park" })).toEqual(["B-201"]);
      expect(await nos({ status: "reserved" })).toEqual(["A-102"]);
      expect(await nos({ saleModel: "spu" })).toEqual(["B-201"]);
      expect(await nos({ nature: "apartment" })).toEqual(["A-101"]);
      const list = await listUnits(db, f.actors.agent1, {}, f.projectId);
      expect(list.natures).toEqual(["Apartment", "Shop"]);
      expect(list.statusCounts).toEqual({ available: 2, reserved: 1 });
    });
  });
});
