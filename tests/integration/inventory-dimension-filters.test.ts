import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUnit } from "@/modules/inventory/commands";
import { listUnits } from "@/modules/inventory/queries";
import { updateProjectDimensions } from "@/modules/projects/commands";
import { units } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

describe.skipIf(!hasTestDb)("FR-061: inventory filters by project dimension (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    await updateProjectDimensions(db, f.actors.superAdmin, f.projectId, {
      floors: ["Ground", "First", "Roof"],
      blocks: ["A", "B"],
      categories: ["Apartment"],
      types: ["Studio", "Suite"],
      premiums: ["Corner"],
    });
    const unit = (unitNo: string, extra: Record<string, unknown>, areaSqft = "500", projectId = f.projectId) =>
      createUnit(db, f.actors.superAdmin, { projectId, unitNo, areaSqft, basePrice: "10000000", ...extra });
    await unit("U1", { floor: "Ground", block: "A", category: "Apartment", type: "Studio", premium: "Corner" });
    await unit("U2", { floor: "First", block: "A", category: "Apartment", type: "Suite" }, "750");
    await unit("U3", { floor: "First", block: "B" }, "750");
    await unit("X1", { floor: "Basement", block: "Z" }, "900", f.otherProjectId);
  });

  const list = (query: Record<string, string> = {}) => listUnits(db, f.actors.superAdmin, query, f.projectId);
  const unitNos = async (query: Record<string, string>) => (await list(query)).rows.map((r) => r.unitNo).sort();
  const options = async (param: string, query: Record<string, string> = {}) =>
    (await list(query)).dimensionFilters.find((d) => d.param === param)?.options.map((o) => o.label);

  it.each([
    ["floor", "First", ["U2", "U3"]],
    ["block", "B", ["U3"]],
    ["category", "Apartment", ["U1", "U2"]],
    ["type", "Studio", ["U1"]],
    ["premium", "Corner", ["U1"]],
    ["area", "750", ["U2", "U3"]],
  ])("filters by %s", async (param, value, expected) => {
    expect(await unitNos({ [param]: value })).toEqual(expected);
  });

  it("combines filters with AND, and with the existing ones", async () => {
    expect(await unitNos({ floor: "First", block: "A" })).toEqual(["U2"]);
    expect(await unitNos({ floor: "First", block: "A", type: "Studio" })).toEqual([]);
    expect(await unitNos({ floor: "First", q: "U3" })).toEqual(["U3"]);
  });

  it("ignores letter case, as the Nature filter does", async () => {
    expect(await unitNos({ floor: "first" })).toEqual(["U2", "U3"]);
  });

  it("the total and paging follow the filter", async () => {
    expect((await list({ floor: "First" })).total).toBe(2);
  });

  it("offers the project's configured values in their order, even before any unit uses them", async () => {
    expect(await options("floor")).toEqual(["Ground", "First", "Roof"]);
  });

  it("also offers values units already hold outside the configured list, without duplicates", async () => {
    await db.update(units).set({ floor: "Mezzanine" }).where(eq(units.unitNo, "U3"));
    await db.update(units).set({ floor: "GROUND" }).where(eq(units.unitNo, "U2"));
    expect(await options("floor")).toEqual(["Ground", "First", "Roof", "Mezzanine"]);
  });

  it("uses each project's own values, never another project's", async () => {
    expect(await options("floor")).not.toContain("Basement");
    expect(await options("floor", { project: f.otherProjectId })).toEqual(["Basement"]);
    expect(await options("area", { project: f.otherProjectId })).toEqual(["900 sq ft"]);
  });

  it("offers sizes in use, in order", async () => {
    expect(await options("area")).toEqual(["500 sq ft", "750 sq ft"]);
  });

  it("offers no dimension filters across all projects", async () => {
    expect((await list({ project: "all" })).dimensionFilters).toEqual([]);
  });

  it("leaves out a dimension with no values", async () => {
    await updateProjectDimensions(db, f.actors.superAdmin, f.otherProjectId, {});
    expect(await options("premium", { project: f.otherProjectId })).toBeUndefined();
  });

  it("bad values match nothing or are ignored, and never fail", async () => {
    expect(await unitNos({ floor: "'; drop table units; --" })).toEqual([]);
    expect(await unitNos({ area: "not-a-number" })).toEqual(["U1", "U2", "U3"]);
    expect(await unitNos({ area: "-5" })).toEqual(["U1", "U2", "U3"]);
  });
});
