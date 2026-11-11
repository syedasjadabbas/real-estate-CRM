import { describe, expect, it } from "vitest";
import { buildRows, computeFigures, installmentDueOn, rowsTotal, unitPricePerSqft } from "@/modules/tasks/plan";
import { floorCode } from "@/modules/tasks/constants";
import { canAccessTask, canAssignTo, canDoTask, canEditDownPayment, canEditSavedProposal, canEditTaskDetails, discountCap, taskScope } from "@/modules/tasks/policy";
import { createTaskSchema, proposalSettingsSchema, taskListQuerySchema } from "@/modules/tasks/validation";
import type { Role } from "@/server/auth/types";

const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];
const me = "6f1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e11";
const mate = "7a1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e12";
const other = "8b1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e13";

describe("tasks policy (Tasks F/F/T/O/—/—)", () => {
  it("maps roles to actions and scopes", () => {
    expect(roles.filter((role) => canDoTask({ role }, "view"))).toEqual(["super_admin", "admin", "manager", "agent", "hr", "accountant"]);
    // Q45: HR and Accountants receive tasks but don't create them.
    expect(roles.filter((role) => canDoTask({ role }, "create"))).toEqual(["super_admin", "admin", "manager", "agent"]);
    expect(roles.filter((role) => canDoTask({ role }, "settings"))).toEqual(["super_admin", "admin"]);
    expect(roles.map(taskScope)).toEqual(["all", "all", "team", "own", "own", "own"]);
  });

  it("scopes records by assignee or creator", () => {
    const task = { assigneeId: mate, createdById: other };
    expect(canAccessTask({ id: me, role: "agent" }, task)).toBe(false);
    expect(canAccessTask({ id: mate, role: "agent" }, task)).toBe(true);
    expect(canAccessTask({ id: other, role: "agent" }, task)).toBe(true);
    expect(canAccessTask({ id: me, role: "manager" }, task, [mate])).toBe(true);
    expect(canAccessTask({ id: me, role: "manager" }, task, [])).toBe(false);
    expect(canAccessTask({ id: me, role: "hr" }, task)).toBe(false);
    expect(canAccessTask({ id: me, role: "admin" }, task)).toBe(true);
  });

  it("limits who can be assigned: only Admins and Super Admins assign to others (Q45)", () => {
    expect(canAssignTo({ id: me, role: "agent" }, me)).toBe(true);
    expect(canAssignTo({ id: me, role: "agent" }, mate)).toBe(false);
    expect(canAssignTo({ id: me, role: "manager" }, me)).toBe(true);
    expect(canAssignTo({ id: me, role: "manager" }, mate)).toBe(false);
    expect(canAssignTo({ id: me, role: "admin" }, other)).toBe(true);
    expect(canAssignTo({ id: me, role: "super_admin" }, other)).toBe(true);
  });

  it("lets only the Super Admin edit a saved proposal (Q36)", () => {
    expect(roles.filter(canEditSavedProposal)).toEqual(["super_admin"]);
    expect(canEditTaskDetails("admin", { proposal: { customerName: "Ali" } })).toBe(false);
    expect(canEditTaskDetails("agent", { proposal: null })).toBe(true);
    expect(canEditTaskDetails("super_admin", { proposal: { customerName: "Ali" } })).toBe(true);
  });

  it("applies the discount caps and the agents' down-payment lock", () => {
    const unset = { agentCap: 5, managerCap: null };
    expect(discountCap("agent", unset)).toBe(5);
    expect(discountCap("manager", unset)).toBe(5);
    expect(discountCap("manager", { agentCap: 5, managerCap: 10 })).toBe(10);
    expect(discountCap("admin", unset)).toBe(100);
    expect(discountCap("super_admin", unset)).toBe(100);
    expect(canEditDownPayment("agent")).toBe(false);
    expect(canEditDownPayment("manager")).toBe(true);
  });
});

describe("payment-plan arithmetic", () => {
  it("total = area × rate; discount, down payment and equal installments", () => {
    const f = computeFigures({ areaSqft: 500, pricePerSqft: 20_000, discountPct: 5, downPaymentPct: 30, installmentCount: 36, roiPerSqft: null });
    expect(f.totalList).toBe(10_000_000);
    expect(f.afterDiscount).toBe(9_500_000);
    expect(f.downPayment).toBe(2_850_000);
    expect(f.eachInstallment).toBe(184_722.22);
    expect(f.roiAnnual).toBeNull();
  });

  it("puts leftover paisa on the last row so the schedule adds up exactly", () => {
    const f = computeFigures({ areaSqft: 500, pricePerSqft: 20_000, discountPct: 5, downPaymentPct: 30, installmentCount: 36, roiPerSqft: null });
    const rows = buildRows(f, 36, "Monthly");
    expect(rows).toHaveLength(37);
    expect(rows[0]).toMatchObject({ seq: 1, label: "Down payment", amount: 2_850_000 });
    expect(rows[1]).toMatchObject({ seq: 2, label: "Installment 1", description: "Monthly", amount: 184_722.22 });
    expect(rows[36].amount).toBe(184_722.3);
    expect(rowsTotal(rows)).toBe(9_500_000);
  });

  it("has no schedule without a price, and computes ROI from the per-sq-ft setting", () => {
    const f = computeFigures({ areaSqft: 500, pricePerSqft: null, discountPct: 0, downPaymentPct: 30, installmentCount: 36, roiPerSqft: 1200 });
    expect(f.totalList).toBeNull();
    expect(f.roiAnnual).toBe(600_000);
    expect(buildRows(f, 36, "Monthly")).toEqual([]);
  });

  const prices = (defaultPricePerSqft: number | null, floors: Partial<Record<"floorPriceGF" | "floorPriceFF" | "floorPriceSF", number | null>> = {}) => ({
    defaultPricePerSqft,
    floorPriceGF: null,
    floorPriceFF: null,
    floorPriceSF: null,
    ...floors,
  });
  const clientRates = { floorPriceGF: 10_824, floorPriceFF: 9_593, floorPriceSF: 8_624 };

  it("derives the unit rate from its list price, else the default setting", () => {
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 10_000_000 }, prices(15_000))).toBe(20_000);
    expect(unitPricePerSqft({ areaSqft: 3, basePrice: 10 }, prices(null))).toBe(3.33);
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 0 }, prices(15_000))).toBe(15_000);
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 0 }, prices(null))).toBeNull();
  });

  it("uses the floor rate (Q44) when a unit has no list price; the unit price always wins", () => {
    const s = prices(15_000, clientRates);
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 0, floor: "GF" }, s)).toBe(10_824);
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 0, floor: "First floor" }, s)).toBe(9_593);
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 0, floor: " sf " }, s)).toBe(8_624);
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 10_000_000, floor: "GF" }, s)).toBe(20_000);
    // Other floors, no floor, or a cleared floor rate fall back to the default price.
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 0, floor: "Roof" }, s)).toBe(15_000);
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 0, floor: null }, s)).toBe(15_000);
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 0, floor: "GF" }, prices(15_000, { ...clientRates, floorPriceGF: null }))).toBe(15_000);
  });

  it("recognises floor codes and names", () => {
    expect(["GF", "ground", "Ground Floor", "ff", "1st floor", "SF", "SS", "Second"].map(floorCode)).toEqual(["GF", "GF", "GF", "FF", "FF", "SF", "SF", "SF"]);
    expect(["", null, "Roof", "Mezzanine", "G"].map(floorCode)).toEqual([null, null, null, null, null]);
  });
});

describe("tasks validation", () => {
  it("requires a title and a known type; trims optional fields", () => {
    expect(createTaskSchema.safeParse({ title: " ", type: "general" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "Call", type: "meeting" }).success).toBe(false);
    const ok = createTaskSchema.parse({ title: " Call back ", type: "general", leadId: "", dueAt: "" });
    expect(ok).toMatchObject({ title: "Call back", leadId: null, dueAt: null });
  });

  it("validates proposal numbers and rows", () => {
    const base = { title: "Plan", type: "proposal", proposal: { customerName: "Ali" } };
    expect(createTaskSchema.safeParse({ ...base, proposal: { customerName: "" } }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, proposal: { customerName: "Ali", discountPct: "101" } }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, proposal: { customerName: "Ali", installmentCount: "0" } }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, rows: [{ label: "Down", amount: "-1" }] }).success).toBe(false);
    expect(createTaskSchema.parse(base).proposal?.discountPct).toBe(0);
  });

  it("falls back to safe list defaults and lets blank clear optional settings", () => {
    expect(taskListQuerySchema.parse({ sort: "bogus", dir: "x", page: "-3" })).toMatchObject({ sort: "updatedAt", dir: "desc", page: 1 });
    expect(proposalSettingsSchema.parse({ managerCap: "", roiPerSqft: "" })).toEqual({ managerCap: null, roiPerSqft: null });
    expect(proposalSettingsSchema.parse({ floorPriceGF: "10,824", floorPriceSF: "" })).toEqual({ floorPriceGF: 10_824, floorPriceSF: null });
    expect(proposalSettingsSchema.safeParse({ floorPriceFF: "-1" }).success).toBe(false);
    expect(proposalSettingsSchema.safeParse({ agentCap: "" }).success).toBe(false);
  });
});

describe("installment due dates (Q43)", () => {
  it("falls on the 10th of consecutive months and rolls over the year", () => {
    expect(installmentDueOn("2026-11", 0)).toBe("2026-11-10");
    expect(installmentDueOn("2026-11", 2)).toBe("2027-01-10");
    expect(installmentDueOn("2026-01", 35)).toBe("2028-12-10");
  });

  it("dates installment rows only, never the down payment, and only with a first month", () => {
    const f = computeFigures({ areaSqft: 500, pricePerSqft: 20_000, discountPct: 0, downPaymentPct: 25, installmentCount: 2, roiPerSqft: null });
    expect(buildRows(f, 2, "Monthly", "2027-02").map((r) => r.dueOn)).toEqual([null, "2027-02-10", "2027-03-10"]);
    expect(buildRows(f, 2, "Monthly").map((r) => r.dueOn)).toEqual([null, null, null]);
  });
});
