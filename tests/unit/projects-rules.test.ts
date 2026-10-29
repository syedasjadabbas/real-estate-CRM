import { describe, expect, it } from "vitest";
import { canDoProject, seesInactiveInSelector } from "@/modules/projects/policy";
import { createProjectSchema, projectListQuerySchema, updateProjectSchema } from "@/modules/projects/validation";
import type { Role } from "@/server/auth/types";

const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];

describe("projects policy", () => {
  it("follows the matrix: view F/F/R/R/—/R, create and edit by admins only", () => {
    expect(roles.filter((role) => canDoProject({ role }, "view"))).toEqual(["super_admin", "admin", "manager", "agent", "accountant"]);
    expect(roles.filter((role) => canDoProject({ role }, "manage"))).toEqual(["super_admin", "admin"]);
  });

  it("shows inactive projects in the selector to admins only", () => {
    expect(roles.filter((role) => seesInactiveInSelector({ role }))).toEqual(["super_admin", "admin"]);
  });
});

describe("projects validation", () => {
  it("requires a name and a known type and status", () => {
    const r = createProjectSchema.safeParse({ name: " ", type: "tower", status: "archived" });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["name", "type", "status"]));
  });

  it("defaults type and status on create and treats empty optional fields as not set", () => {
    expect(createProjectSchema.parse({ name: "Serene Heights", developer: "", city: " " })).toMatchObject({
      type: "building",
      status: "active",
      developer: undefined,
      city: undefined,
    });
  });

  it("limits text lengths", () => {
    const r = createProjectSchema.safeParse({ name: "A".repeat(121), description: "x".repeat(2001) });
    expect(r.success ? [] : r.error.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["name", "description"]));
  });

  it("keeps partial updates partial (no defaults)", () => {
    expect(updateProjectSchema.parse({ city: "Murree" })).toEqual({ city: "Murree" });
  });

  it("falls back to defaults for invalid list params", () => {
    expect(projectListQuerySchema.parse({ type: "tower", status: "x", page: "0" })).toEqual({ q: undefined, type: undefined, status: undefined, page: 1 });
  });
});
