import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { convertLeadToClient } from "@/modules/clients/commands";
import { createLead } from "@/modules/leads/commands";
import { createProject, updateProject } from "@/modules/projects/commands";
import { getProjectDetail, listProjects, selectableProjects } from "@/modules/projects/queries";
import { hashPassword } from "@/server/auth/password";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, projects, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

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

describe.skipIf(!hasTestDb)("Projects module (PostgreSQL integration)", () => {
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

  describe("create and edit", () => {
    it("creates a project with all documented fields and an audit entry", async () => {
      const { projectId } = await createProject(db, f.actors.superAdmin, {
        name: "Serene Heights T3",
        type: "farmhouse",
        developer: "DM Consortium",
        city: "Nathia Gali",
        address: "Main Murree Road",
        description: "Phase 3 farmhouses",
      });
      const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
      expect(row).toMatchObject({ type: "farmhouse", status: "active", developer: "DM Consortium", address: "Main Murree Road" });
      const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, projectId));
      expect(audit.map((a) => [a.action, a.entity])).toEqual([["project.create", "project"]]);
    });

    it("rejects invalid input and duplicate names ignoring case", async () => {
      const invalid = await errorOf(createProject(db, f.actors.superAdmin, { name: "", type: "tower" }));
      expect(invalid?.code).toBe("VALIDATION_FAILED");
      expect(Object.keys(invalid?.fields ?? {})).toEqual(expect.arrayContaining(["name", "type"]));

      const dup = await errorOf(createProject(db, f.actors.superAdmin, { name: "  test PROJECT " }));
      expect(dup?.code).toBe("CONFLICT");
      expect(dup?.fields).toHaveProperty("name");
    });

    it("applies partial edits, clears optional fields, and audits deactivation", async () => {
      expect(await updateProject(db, f.actors.superAdmin, f.projectId, { developer: "New Dev", city: "Lahore" })).toEqual({
        changed: ["developer", "city"],
      });
      expect(await updateProject(db, f.actors.superAdmin, f.projectId, { developer: "" })).toEqual({ changed: ["developer"] });
      expect(await updateProject(db, f.actors.superAdmin, f.projectId, { city: "Lahore" })).toEqual({ changed: [] });
      await updateProject(db, f.actors.superAdmin, f.projectId, { status: "inactive" });

      const [row] = await db.select().from(projects).where(eq(projects.id, f.projectId));
      expect(row).toMatchObject({ developer: null, city: "Lahore", status: "inactive", name: "Test Project" });
      const actions = (await db.select().from(auditLogs).where(eq(auditLogs.entityId, f.projectId))).map((a) => a.action);
      expect(actions).toEqual(["project.update", "project.update", "project.deactivate"]);

      expect(await errorCode(updateProject(db, f.actors.superAdmin, f.projectId, { name: "other project" }))).toBe("CONFLICT");
      expect(await errorCode(updateProject(db, f.actors.superAdmin, "00000000-0000-4000-8000-000000000000", { city: "X" }))).toBe("NOT_FOUND");
    });

    it("lets only admins create or edit", async () => {
      for (const actor of [f.actors.manager, f.actors.agent1, accountant, f.actors.hr]) {
        expect(await errorCode(createProject(db, actor, { name: "Not allowed" }))).toBe("FORBIDDEN");
        expect(await errorCode(updateProject(db, actor, f.projectId, { city: "X" }))).toBe("FORBIDDEN");
      }
    });
  });

  describe("list, selector and links", () => {
    it("searches, filters, counts KPIs and shows inactive projects to every viewer", async () => {
      await createProject(db, f.actors.superAdmin, { name: "Hill Farms", type: "farmhouse", developer: "Green Estates", status: "inactive" });
      await createProject(db, f.actors.superAdmin, { name: "City Society", type: "society", city: "Rawalpindi" });

      const all = await listProjects(db, f.actors.agent1, {});
      expect(all.total).toBe(4);
      expect(all.kpis).toEqual({ projects: 4, projectTypes: 3, unitsTracked: 0 });
      expect(all.rows.map((r) => r.name)).toEqual(["City Society", "Other Project", "Test Project", "Hill Farms"]);

      const names = async (q: Record<string, string>) => (await listProjects(db, accountant, q)).rows.map((r) => r.name);
      expect(await names({ q: "green" })).toEqual(["Hill Farms"]);
      expect(await names({ q: "rawal" })).toEqual(["City Society"]);
      expect(await names({ type: "farmhouse" })).toEqual(["Hill Farms"]);
      expect(await names({ status: "inactive" })).toEqual(["Hill Farms"]);
      expect(await errorCode(listProjects(db, f.actors.hr, {}))).toBe("FORBIDDEN");
    });

    it("offers inactive projects in the selector to admins only; new leads still need an active project", async () => {
      await updateProject(db, f.actors.superAdmin, f.otherProjectId, { status: "inactive" });
      expect((await selectableProjects(db, f.actors.superAdmin)).map((p) => p.name)).toEqual(["Test Project", "Other Project (inactive)"]);
      for (const actor of [f.actors.manager, f.actors.agent1, accountant]) {
        expect((await selectableProjects(db, actor)).map((p) => p.name)).toEqual(["Test Project"]);
      }
      expect(await selectableProjects(db, null)).toHaveLength(1);
      expect(await errorCode(createLead(db, f.actors.superAdmin, leadInput(f, { projectId: f.otherProjectId })))).toBe("VALIDATION_FAILED");
    });

    it("counts linked leads and clients within the viewer's own scope", async () => {
      const mine = await createLead(db, f.actors.agent1, leadInput(f));
      await createLead(db, f.actors.agent2, leadInput(f));
      const outside = await createLead(db, f.actors.outsideAgent, leadInput(f));
      if (mine.outcome !== "created" || outside.outcome !== "created") throw new Error("setup");
      await convertLeadToClient(db, f.actors.superAdmin, { leadId: mine.leadId });
      await convertLeadToClient(db, f.actors.superAdmin, { leadId: outside.leadId });

      const links = async (actor: Actor) => (await getProjectDetail(db, actor, f.projectId)).links;
      expect(await links(f.actors.agent1)).toEqual({ leads: 1, clients: 1, unitsTracked: 0 });
      // Every lead has its person's client since 13 Nov 2026, so each of the three leads brings one.
      expect(await links(f.actors.manager)).toEqual({ leads: 2, clients: 2, unitsTracked: 0 });
      expect(await links(f.actors.superAdmin)).toEqual({ leads: 3, clients: 3, unitsTracked: 0 });
      expect(await links(accountant)).toEqual({ leads: null, clients: 3, unitsTracked: 0 });
      expect((await getProjectDetail(db, f.actors.agent1, f.otherProjectId)).links.leads).toBe(0);
      expect((await getProjectDetail(db, f.actors.agent1, f.projectId)).permissions.manage).toBe(false);
      expect(await errorCode(getProjectDetail(db, f.actors.hr, f.projectId))).toBe("FORBIDDEN");
      expect(await errorCode(getProjectDetail(db, f.actors.agent1, "not-a-uuid"))).toBe("NOT_FOUND");
    });
  });
});
