import { describe, expect, it } from "vitest";
import { canDoInventory } from "@/modules/inventory/policy";
import { createUnitSchema, dimensionsSchema, statusChangeSchema, unitListQuerySchema, updateUnitSchema } from "@/modules/inventory/validation";
import type { Role } from "@/server/auth/types";

const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];
const PROJECT = "6f1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e11";

describe("inventory policy", () => {
  it("follows the matrix: view F/F/R/R/—/R, edit by admins only", () => {
    expect(roles.filter((role) => canDoInventory({ role }, "view"))).toEqual(["super_admin", "admin", "manager", "agent", "accountant"]);
    expect(roles.filter((role) => canDoInventory({ role }, "manage"))).toEqual(["super_admin", "admin"]);
  });
});

describe("inventory validation", () => {
  it("requires project, unit number, positive area and non-negative price", () => {
    const r = createUnitSchema.safeParse({ projectId: "x", unitNo: "", areaSqft: "0", basePrice: "-1" });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["projectId", "unitNo", "areaSqft", "basePrice"]));
  });

  it("parses form strings: thousands separators, empty optionals, whole-number bedrooms, ISO dates", () => {
    const r = createUnitSchema.parse({
      projectId: PROJECT,
      unitNo: " A-101 ",
      areaSqft: "674.5",
      basePrice: "12,500,000",
      bedrooms: "2",
      floor: "",
      listedOn: "2026-10-29",
    });
    expect(r).toMatchObject({ unitNo: "A-101", areaSqft: 674.5, basePrice: 12_500_000, bedrooms: 2, floor: undefined, saleModel: "whole" });
    expect(createUnitSchema.safeParse({ projectId: PROJECT, unitNo: "A", areaSqft: "10", basePrice: "1", bedrooms: "1.5" }).success).toBe(false);
    expect(createUnitSchema.safeParse({ projectId: PROJECT, unitNo: "A", areaSqft: "10", basePrice: "1", listedOn: "29/10/2026" }).success).toBe(false);
  });

  it("allows two decimals but not three", () => {
    expect(createUnitSchema.safeParse({ projectId: PROJECT, unitNo: "A", areaSqft: "12.34", basePrice: "1" }).success).toBe(true);
    expect(createUnitSchema.safeParse({ projectId: PROJECT, unitNo: "A", areaSqft: "12.345", basePrice: "1" }).success).toBe(false);
  });

  it("keeps partial updates partial and requires a reason for status changes", () => {
    expect(updateUnitSchema.parse({ comment: "Corner" })).toEqual({ comment: "Corner" });
    expect(statusChangeSchema.safeParse({ status: "sold", reason: "" }).success).toBe(false);
    expect(statusChangeSchema.safeParse({ status: "hold", reason: "Client asked" }).success).toBe(false);
  });

  it("cleans dimension lists: trims, drops blanks and case-insensitive duplicates", () => {
    expect(dimensionsSchema.parse({ floors: [" Ground ", "", "ground", "1st"] })).toEqual({ floors: ["Ground", "1st"] });
  });

  it("falls back to defaults for invalid list params", () => {
    expect(unitListQuerySchema.parse({ project: "nope", status: "x", saleModel: "y", page: "0" })).toMatchObject({
      project: undefined,
      status: undefined,
      saleModel: undefined,
      page: 1,
    });
    expect(unitListQuerySchema.parse({ project: "all" }).project).toBe("all");
  });
});
