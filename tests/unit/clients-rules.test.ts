import { describe, expect, it } from "vitest";
import { canAccessClient, canDoClient, clientScope } from "@/modules/clients/policy";
import { clientListQuerySchema, convertLeadSchema, createClientSchema, updateClientSchema } from "@/modules/clients/validation";
import type { Role } from "@/server/auth/types";

const actor = (role: Role, id = "me") => ({ id, role });

describe("clients policy", () => {
  it("maps roles to scopes (matrix: F/F/T/O/—/R)", () => {
    expect(clientScope("super_admin")).toBe("all");
    expect(clientScope("admin")).toBe("all");
    expect(clientScope("accountant")).toBe("all");
    expect(clientScope("manager")).toBe("team");
    expect(clientScope("agent")).toBe("own");
    expect(clientScope("hr")).toBe("none");
  });

  it("limits who creates, edits and reassigns", () => {
    expect(canDoClient(actor("admin"), "createManual")).toBe(true);
    expect(canDoClient(actor("manager"), "createManual")).toBe(false);
    expect(canDoClient(actor("manager"), "convertLead")).toBe(true);
    expect(canDoClient(actor("agent"), "convertLead")).toBe(false);
    expect(canDoClient(actor("agent"), "edit")).toBe(true);
    expect(canDoClient(actor("agent"), "assign")).toBe(false);
    expect(canDoClient(actor("accountant"), "view")).toBe(true);
    expect(canDoClient(actor("accountant"), "edit")).toBe(false);
    expect(canDoClient(actor("hr"), "view")).toBe(false);
  });

  it("scopes access by owner", () => {
    expect(canAccessClient(actor("agent"), "me")).toBe(true);
    expect(canAccessClient(actor("agent"), "someone")).toBe(false);
    expect(canAccessClient(actor("manager"), "a1", ["a1"])).toBe(true);
    expect(canAccessClient(actor("manager"), "outside", ["a1"])).toBe(false);
    expect(canAccessClient(actor("manager"), null, ["a1"])).toBe(false);
    expect(canAccessClient(actor("accountant"), "anyone")).toBe(true);
    expect(canAccessClient(actor("hr"), "me")).toBe(false);
  });
});

describe("clients validation", () => {
  it("requires name and phone, and checks email and relationship", () => {
    const r = createClientSchema.safeParse({ name: "", phoneCountryCode: "+92", phoneNumber: "1", email: "nope", relationship: "vip" });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["name", "phoneNumber", "email", "relationship"]));
  });

  it("treats empty optional fields as not set", () => {
    const r = createClientSchema.parse({ name: "Ali", phoneCountryCode: "+92", phoneNumber: "3001234567", email: "", cityId: "", relationship: "" });
    expect(r).toMatchObject({ email: undefined, cityId: undefined, relationship: undefined });
  });

  it("keeps partial updates partial (no defaults)", () => {
    expect(updateClientSchema.parse({ name: "New name" })).toEqual({ name: "New name" });
  });

  it("defaults conversion to warn on an existing client", () => {
    expect(convertLeadSchema.parse({ leadId: "6f1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e11" }).onExisting).toBe("reject");
  });

  it("falls back to defaults for invalid list params", () => {
    expect(clientListQuerySchema.parse({ sort: "bogus", dir: "x", page: "-3" })).toMatchObject({ sort: "updatedAt", dir: "desc", page: 1 });
  });
});
