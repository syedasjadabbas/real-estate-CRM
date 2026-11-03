import { describe, expect, it } from "vitest";
import { buildRows, computeFigures, installmentDueOn, rowsTotal, unitPricePerSqft } from "@/modules/tasks/plan";
import { canAccessTask, canAssignTo, canDoTask, canEditDownPayment, discountCap, taskScope } from "@/modules/tasks/policy";
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

  it("limits who can be assigned", () => {
    expect(canAssignTo({ id: me, role: "agent" }, me)).toBe(true);
    expect(canAssignTo({ id: me, role: "agent" }, mate)).toBe(false);
    expect(canAssignTo({ id: me, role: "manager" }, mate, [mate])).toBe(true);
    expect(canAssignTo({ id: me, role: "manager" }, other, [mate])).toBe(false);
    expect(canAssignTo({ id: me, role: "admin" }, other)).toBe(true);
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

  it("derives the unit rate from its list price, else the default setting", () => {
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 10_000_000 }, 15_000)).toBe(20_000);
    expect(unitPricePerSqft({ areaSqft: 3, basePrice: 10 }, null)).toBe(3.33);
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 0 }, 15_000)).toBe(15_000);
    expect(unitPricePerSqft({ areaSqft: 500, basePrice: 0 }, null)).toBeNull();
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
