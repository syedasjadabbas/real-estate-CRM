import { describe, expect, it } from "vitest";
import { canManageAccount, canManageAccounts, grantableRoles } from "@/modules/accounts/policy";
import { createAccountSchema, reassignLeadsSchema } from "@/modules/accounts/validation";
import { ROLES } from "@/server/auth/types";

describe("account management rules (Q2, C-1 default)", () => {
  it("only Admin and Super Admin manage accounts", () => {
    expect(ROLES.filter((role) => canManageAccounts({ role }))).toEqual(["super_admin", "admin"]);
  });

  it("an Admin can't act on or grant Super Admin; a Super Admin can", () => {
    expect(canManageAccount({ role: "admin" }, "agent", "manager")).toBe(true);
    expect(canManageAccount({ role: "admin" }, "super_admin")).toBe(false);
    expect(canManageAccount({ role: "admin" }, "agent", "super_admin")).toBe(false);
    expect(canManageAccount({ role: "super_admin" }, "super_admin", "admin")).toBe(true);
    expect(grantableRoles({ role: "admin" })).not.toContain("super_admin");
    expect(grantableRoles({ role: "super_admin" })).toContain("super_admin");
    expect(grantableRoles({ role: "hr" })).toEqual([]);
  });

  it("normalises email and requires a 10-character password", () => {
    const ok = createAccountSchema.safeParse({ name: "  A   B ", email: " A@B.Test ", role: "agent", password: "0123456789" });
    expect(ok.success && ok.data).toMatchObject({ name: "A B", email: "a@b.test" });
    expect(createAccountSchema.safeParse({ name: "A", email: "a@b.test", role: "agent", password: "012345678" }).success).toBe(false);
  });

  it("the lead shift needs a receiver and at least one group", () => {
    const to = "00000000-0000-4000-8000-000000000000";
    expect(reassignLeadsSchema.safeParse({ toUserId: to }).success).toBe(false);
    expect(reassignLeadsSchema.safeParse({ toUserId: to, lost: true }).success).toBe(true);
  });
});
