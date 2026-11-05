import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activeProjectFor, projectCookieName, selectableProjects } from "@/modules/projects/queries";
import { loadActor } from "@/server/auth/session-store";
import { projects, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

/** One browser's cookies, shared by whoever signs in on it. */
const browser = () => {
  const jar = new Map<string, string>();
  return { jar, read: (name: string) => jar.get(name), choose: (actor: Pick<Actor, "id">, projectId: string) => jar.set(projectCookieName(actor.id), projectId) };
};

describe.skipIf(!hasTestDb)("FR-004: the active project is remembered per user and device (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [u] = await db.insert(users).values({ name: "Zed Admin", email: "admin@test.local", role: "admin", passwordHash: "x" }).returning();
    admin = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  });

  const active = async (actor: Actor | null, b: ReturnType<typeof browser>) => (await activeProjectFor(db, actor, b.read)).activeProjectId;
  /** With nothing saved, the first project offered ("Other Project" sorts before "Test Project"). */
  const first = () => f.otherProjectId;

  it("with no saved choice, a user gets the first project they can select", async () => {
    expect(await active(f.actors.agent1, browser())).toBe(first());
  });

  it("each person on a shared browser keeps their own choice, and nobody inherits another's", async () => {
    const shared = browser();
    shared.choose(f.actors.manager, f.projectId);
    expect(await active(f.actors.manager, shared)).toBe(f.projectId);
    // The next person signs in on the same browser.
    expect(await active(f.actors.agent1, shared)).toBe(first());
    shared.choose(f.actors.agent1, f.otherProjectId);
    expect(await active(f.actors.agent1, shared)).toBe(f.otherProjectId);
    // The first person comes back: their own choice is restored.
    expect(await active(f.actors.manager, shared)).toBe(f.projectId);
  });

  it("the same person on two devices can have two choices", async () => {
    const laptop = browser();
    const phone = browser();
    laptop.choose(f.actors.agent1, f.projectId);
    phone.choose(f.actors.agent1, f.otherProjectId);
    expect(await active(f.actors.agent1, laptop)).toBe(f.projectId);
    expect(await active(f.actors.agent1, phone)).toBe(f.otherProjectId);
  });

  it("the old shared cookie is never read, and signed-out visitors read no choice", async () => {
    const shared = browser();
    shared.jar.set("mz_project", f.projectId);
    expect(await active(f.actors.agent1, shared)).toBe(first());
    shared.choose(f.actors.agent1, f.projectId);
    expect(await active(null, shared)).toBe(first());
  });

  it("switching replaces only that person's choice", async () => {
    const b = browser();
    b.choose(f.actors.manager, f.projectId);
    b.choose(f.actors.agent2, f.projectId);
    b.choose(f.actors.manager, f.otherProjectId);
    expect(await active(f.actors.manager, b)).toBe(f.otherProjectId);
    expect(await active(f.actors.agent2, b)).toBe(f.projectId);
  });

  it("a project made inactive falls back for those who can't select it, and stays for admins", async () => {
    const b = browser();
    b.choose(f.actors.agent1, f.projectId);
    b.choose(admin, f.projectId);
    await db.update(projects).set({ status: "inactive" }).where(eq(projects.id, f.projectId));
    expect(await active(f.actors.agent1, b)).toBe(f.otherProjectId);
    expect(await active(admin, b)).toBe(f.projectId);
    // Reactivated: the saved choice applies again.
    await db.update(projects).set({ status: "active" }).where(eq(projects.id, f.projectId));
    expect(await active(f.actors.agent1, b)).toBe(f.projectId);
  });

  it("a role change that removes access falls back", async () => {
    const b = browser();
    await db.update(projects).set({ status: "inactive" }).where(eq(projects.id, f.projectId));
    b.choose(admin, f.projectId);
    expect(await active(admin, b)).toBe(f.projectId);
    await db.update(users).set({ role: "agent" }).where(eq(users.id, admin.id));
    expect(await active({ ...admin, role: "agent" }, b)).toBe(f.otherProjectId);
  });

  it("an unknown, removed or tampered value falls back; with no projects there is none", async () => {
    const b = browser();
    for (const bad of ["00000000-0000-4000-8000-000000000000", "not-a-project", "'; drop table projects"]) {
      b.jar.set(projectCookieName(f.actors.agent1.id), bad);
      expect(await active(f.actors.agent1, b)).toBe(first());
    }
    await db.update(projects).set({ status: "inactive" });
    expect(await activeProjectFor(db, f.actors.agent1, b.read)).toEqual({ projects: [], activeProjectId: null });
  });

  it("access rules are unchanged: the projects offered are the selector's", async () => {
    await db.update(projects).set({ status: "inactive" }).where(eq(projects.id, f.projectId));
    for (const who of [f.actors.agent1, f.actors.manager, f.actors.hr, admin, f.actors.superAdmin]) {
      expect((await activeProjectFor(db, who, browser().read)).projects).toEqual(await selectableProjects(db, who));
    }
    expect((await selectableProjects(db, f.actors.agent1)).map((p) => p.id)).toEqual([f.otherProjectId]);
    expect((await selectableProjects(db, admin)).map((p) => p.id)).toEqual([f.otherProjectId, f.projectId]);
  });

  it("cookie names differ per user", () => {
    expect(projectCookieName(f.actors.agent1.id)).not.toBe(projectCookieName(f.actors.agent2.id));
    expect(projectCookieName(f.actors.agent1.id)).toMatch(/^mz_project_[0-9a-f-]{36}$/);
  });
});
