import { describe, expect, it } from "vitest";
import { canDoFinance, canSeeItemisedPayments } from "@/modules/finance/policy";
import { financeSettingsSchema, recordPaymentSchema, reversalRequestSchema } from "@/modules/finance/validation";
import type { Role } from "@/server/auth/types";

const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];
const ID = "6f1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e11";

describe("finance policy (proposed Q-F2 defaults)", () => {
  it("lets finance record and request, managers / admins decide, super admin configure", () => {
    expect(roles.filter((role) => canDoFinance({ role }, "record"))).toEqual(["super_admin", "accountant"]);
    expect(roles.filter((role) => canDoFinance({ role }, "requestReversal"))).toEqual(["super_admin", "accountant"]);
    expect(roles.filter((role) => canDoFinance({ role }, "decideReversal"))).toEqual(["super_admin", "admin", "manager"]);
    expect(roles.filter((role) => canDoFinance({ role }, "viewAll"))).toEqual(["super_admin", "admin", "accountant"]);
    expect(roles.filter((role) => canDoFinance({ role }, "settings"))).toEqual(["super_admin"]);
    expect(roles.filter((role) => canSeeItemisedPayments({ role }))).toEqual(["super_admin", "admin", "manager", "accountant"]);
  });
});

describe("finance validation", () => {
  it("requires booking, type, positive 2-decimal amount, ISO date and method", () => {
    const bad = recordPaymentSchema.safeParse({ bookingId: "x", type: "refund", amount: "-5", receivedOn: "29/10/2026", methodId: "" });
    expect(bad.success ? [] : bad.error.issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(["bookingId", "type", "amount", "receivedOn", "methodId"]),
    );
    expect(recordPaymentSchema.parse({ bookingId: ID, type: "token", amount: "500,000.50", receivedOn: "2026-10-29", methodId: ID })).toMatchObject({
      amount: 500_000.5,
    });
  });

  it("requires a real reason for reversals and safe prefixes", () => {
    expect(reversalRequestSchema.safeParse({ reason: "oops" }).success).toBe(false);
    expect(financeSettingsSchema.safeParse({ receipt_prefix: "MZ/2026-" }).success).toBe(true);
    expect(financeSettingsSchema.safeParse({ receipt_prefix: "<script>" }).success).toBe(false);
  });
});
