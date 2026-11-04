import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUnit } from "@/modules/inventory/commands";
import { listNotifications } from "@/modules/notifications/service";
import { performanceReport } from "@/modules/performance/service";
import { listProjects } from "@/modules/projects/queries";
import { findVisibleTeamId, listTeams, teamTiles, visibleTeams } from "@/modules/teams/queries";
import { loadActor } from "@/server/auth/session-store";
import { notifications, projects, teamMembers, teams, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};
const pad = (n: number) => String(n).padStart(3, "0");
/** Case-insensitive like the database's lower(), blanks last in either direction. */
const lastBlank = <T>(rows: T[], key: (r: T) => string | number | null, dir: "asc" | "desc", tie: (r: T) => string) =>
  [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === null || y === null) return x === y ? tie(a).localeCompare(tie(b)) : x === null ? 1 : -1;
    const c = typeof x === "number" ? x - Number(y) : x.toLowerCase().localeCompare(String(y).toLowerCase());
    return c !== 0 ? (dir === "asc" ? c : -c) : tie(a).localeCompare(tie(b));
  });

describe.skipIf(!hasTestDb)("List pagination and sorting (FR-005, F-5, PostgreSQL integration)", () => {
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
    const [u] = await db.insert(users).values({ name: "Acc", email: "acc@test.local", role: "accountant", passwordHash: "x" }).returning();
    accountant = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  });

  describe("Projects", () => {
    /** `n` projects with lower-case-sensitive names; the fixture adds two more. */
    const seedProjects = (n: number, extra: (i: number) => Partial<typeof projects.$inferInsert> = () => ({})) =>
      db.insert(projects).values(Array.from({ length: n }, (_, i) => ({ name: `Bulk ${pad(i)}`, ...extra(i) })));
    const all = async (query: Record<string, string>) => {
      const first = await listProjects(db, f.actors.superAdmin, query);
      const rows = [...first.rows];
      for (let page = 2; page <= first.pageCount; page++) rows.push(...(await listProjects(db, f.actors.superAdmin, { ...query, page: String(page) })).rows);
      return rows;
    };

    it("shows exactly 50 per page, then the remainder; an out-of-range page lands on the last", async () => {
      await seedProjects(53);
      const first = await listProjects(db, f.actors.agent1, {});
      expect(first).toMatchObject({ total: 55, page: 1, pageCount: 2 });
      expect(first.rows).toHaveLength(50);
      const last = await listProjects(db, f.actors.agent1, { page: "2" });
      expect(last.rows).toHaveLength(5);
      expect(new Set([...first.rows, ...last.rows].map((r) => r.id)).size).toBe(55);
      expect(await listProjects(db, f.actors.agent1, { page: "99" })).toMatchObject({ page: 2, rows: last.rows });
    });

    it("search, filters and paging combine, and counts follow the filtered set while the tiles don't", async () => {
      await seedProjects(120, (i) => ({ name: i < 60 ? `Hill ${pad(i)}` : `Lake ${pad(i)}`, type: i % 60 < 52 ? "farmhouse" : "society", city: "Murree" }));
      const query = { q: "hill", type: "farmhouse" };
      const first = await listProjects(db, f.actors.agent1, query);
      expect(first).toMatchObject({ total: 52, pageCount: 2 });
      expect(first.kpis.projects).toBe(122);
      expect(first.rows).toHaveLength(50);
      const last = await listProjects(db, f.actors.agent1, { ...query, page: "2", sort: "name", dir: "desc" });
      expect(last.rows.map((r) => r.name)).toEqual(["Hill 001", "Hill 000"]);
      expect((await listProjects(db, f.actors.agent1, { ...query, status: "inactive" })).total).toBe(0);
    });

    it("sorts by each column in both directions, blanks last", async () => {
      await seedProjects(6, (i) => ({
        type: (["society", "building", "farmhouse"] as const)[i % 3],
        status: i % 2 ? "inactive" : "active",
        developer: i === 0 ? null : `dev ${String.fromCharCode(70 - i)}`,
        city: i === 1 ? null : i % 2 ? "Murree" : "abbottabad",
      }));
      const projectIds = (await db.select({ id: projects.id, name: projects.name }).from(projects)).filter((p) => p.name.startsWith("Bulk"));
      for (const [n, p] of projectIds.slice(0, 3).entries()) for (let u = 0; u <= n; u++) await createUnit(db, f.actors.superAdmin, { projectId: p.id, unitNo: `U-${n}-${u}`, areaSqft: "500", basePrice: "1000000" });
      const rows = await all({});
      const tie = (r: (typeof rows)[number]) => r.name.toLowerCase();
      const names = (list: typeof rows) => list.map((r) => r.name);
      const columns = { name: (r: (typeof rows)[number]) => r.name, type: (r: (typeof rows)[number]) => r.type, status: (r: (typeof rows)[number]) => r.status, developer: (r: (typeof rows)[number]) => r.developer, city: (r: (typeof rows)[number]) => r.city, units: (r: (typeof rows)[number]) => r.unitsTracked };
      for (const [sort, key] of Object.entries(columns)) {
        for (const dir of ["asc", "desc"] as const) {
          expect(names(await all({ sort, dir })), `${sort} ${dir}`).toEqual(names(lastBlank(rows, key, dir, tie)));
        }
      }
    });

    it("equal values keep one order across pages: no project repeats or goes missing", async () => {
      await seedProjects(120, () => ({ city: "Same", type: "society" }));
      for (const sort of ["city", "type", "units", "status"]) {
        const rows = await all({ sort, q: "bulk" });
        expect(rows.map((r) => r.name)).toEqual(Array.from({ length: 120 }, (_, i) => `Bulk ${pad(i)}`));
        expect(await all({ sort, q: "bulk" })).toEqual(rows);
      }
    });

    it("keeps its default order, and invalid sort values fall back to it", async () => {
      await seedProjects(3, (i) => ({ status: i === 0 ? "inactive" : "active" }));
      const expected = ["Bulk 001", "Bulk 002", "Other Project", "Test Project", "Bulk 000"];
      expect((await listProjects(db, f.actors.agent1, {})).rows.map((r) => r.name)).toEqual(expected);
      for (const bad of [{ sort: "name; drop table projects" }, { sort: "id" }, { sort: "password" }, { sort: "" }]) {
        expect((await listProjects(db, f.actors.agent1, bad)).rows.map((r) => r.name)).toEqual(expected);
      }
      const junk = await listProjects(db, f.actors.agent1, { sort: "name", dir: "sideways", page: "-3" });
      expect(junk.query).toMatchObject({ sort: "name", dir: "asc", page: 1 });
    });

    it("permissions are unchanged: HR can't list projects", async () => {
      expect(await errorCode(listProjects(db, f.actors.hr, { sort: "name" }))).toBe("FORBIDDEN");
      for (const who of [f.actors.superAdmin, f.actors.manager, f.actors.agent1, accountant]) expect((await listProjects(db, who, { sort: "name" })).total).toBe(2);
    });
  });

  describe("Teams", () => {
    /** Fixture: Team 1 (manager, 3 members, active) and Team 2 (no manager, 1 member, active). */
    const seedTeams = (n: number, extra: (i: number) => Partial<typeof teams.$inferInsert> = () => ({})) =>
      db.insert(teams).values(Array.from({ length: n }, (_, i) => ({ name: `Bulk ${pad(i)}`, ...extra(i) }))).returning({ id: teams.id });
    const all = async (query: Record<string, string>) => {
      const first = await listTeams(db, f.actors.superAdmin, query);
      const rows = [...first.rows];
      for (let page = 2; page <= first.pageCount; page++) rows.push(...(await listTeams(db, f.actors.superAdmin, { ...query, page: String(page) })).rows);
      return rows;
    };

    it("shows exactly 50 per page, then the remainder, while selectors and tiles still get every team", async () => {
      await seedTeams(53);
      const first = await listTeams(db, f.actors.superAdmin, {});
      expect(first).toMatchObject({ total: 55, page: 1, pageCount: 2 });
      expect(first.rows).toHaveLength(50);
      const last = await listTeams(db, f.actors.superAdmin, { page: "2" });
      expect(last.rows).toHaveLength(5);
      expect(new Set([...first.rows, ...last.rows].map((r) => r.id)).size).toBe(55);
      expect((await listTeams(db, f.actors.superAdmin, { page: "99" })).page).toBe(2);
      expect(await visibleTeams(db, f.actors.superAdmin)).toHaveLength(55);
      expect((await teamTiles(db, f.actors.superAdmin)).teams).toBe(55);
    });

    it("sorts by name, manager, members and status in both directions, blanks last", async () => {
      const [a, b, c] = await seedTeams(4, (i) => ({ isActive: i !== 1, managerId: i === 0 ? f.actors.agent2.id : i === 2 ? f.actors.superAdmin.id : null }));
      await db.insert(teamMembers).values([
        { teamId: a.id, userId: f.actors.agent1.id },
        { teamId: a.id, userId: f.actors.agent2.id },
        { teamId: b.id, userId: f.actors.outsideAgent.id },
        { teamId: c.id, userId: f.actors.hr.id },
      ]);
      const rows = await all({});
      const tie = (r: (typeof rows)[number]) => r.name.toLowerCase();
      const names = (list: typeof rows) => list.map((r) => r.name);
      const columns = { name: (r: (typeof rows)[number]) => r.name, manager: (r: (typeof rows)[number]) => r.managerName, members: (r: (typeof rows)[number]) => r.members, status: (r: (typeof rows)[number]) => (r.isActive ? 0 : 1) };
      for (const [sort, key] of Object.entries(columns)) {
        for (const dir of ["asc", "desc"] as const) {
          expect(names(await all({ sort, dir })), `${sort} ${dir}`).toEqual(names(lastBlank(rows, key, dir, tie)));
        }
      }
    });

    it("equal values keep one order across pages", async () => {
      await db.delete(teamMembers);
      await seedTeams(120);
      for (const sort of ["members", "status", "manager"]) {
        const rows = await all({ sort });
        expect(new Set(rows.map((r) => r.id)).size).toBe(122);
        expect(await all({ sort })).toEqual(rows);
      }
      expect((await all({ sort: "members" })).map((r) => r.name).slice(0, 2)).toEqual(["Bulk 000", "Bulk 001"]);
    });

    it("keeps its default order, and invalid sort values fall back to it", async () => {
      await seedTeams(2, (i) => ({ isActive: i !== 0 }));
      const expected = ["Bulk 001", "Team 1", "Team 2", "Bulk 000"];
      expect((await listTeams(db, f.actors.hr)).rows.map((r) => r.name)).toEqual(expected);
      expect((await visibleTeams(db, f.actors.hr)).map((r) => r.name)).toEqual(expected);
      for (const bad of [{ sort: "name; drop table teams" }, { sort: "id" }, { sort: "updatedAt" }]) {
        expect((await listTeams(db, f.actors.hr, bad)).rows.map((r) => r.name)).toEqual(expected);
      }
      expect((await listTeams(db, f.actors.hr, { sort: "name", dir: "sideways", page: "x" })).query).toMatchObject({ sort: "name", dir: "asc", page: 1 });
    });

    it("visibility is unchanged: admins and HR see all, managers their own, others none", async () => {
      await seedTeams(2);
      expect((await listTeams(db, f.actors.hr)).total).toBe(4);
      const manager = f.actors.manager;
      const own = await listTeams(db, manager, { sort: "members", dir: "desc" });
      expect(own).toMatchObject({ total: 1, pageCount: 1 });
      expect(own.rows.map((r) => r.name)).toEqual(["Team 1"]);
      expect(await listTeams(db, { ...manager, managedTeamIds: [] })).toMatchObject({ total: 0, rows: [] });
      for (const who of [f.actors.agent1, accountant]) expect(await errorCode(listTeams(db, who))).toBe("FORBIDDEN");
    });

    it("a team selected in the URL stays open from any page; hidden, unknown and junk ids are ignored", async () => {
      const [late] = await seedTeams(60);
      expect(await findVisibleTeamId(db, f.actors.superAdmin, late.id)).toBe(late.id);
      expect(await findVisibleTeamId(db, f.actors.manager, late.id)).toBeNull();
      expect(await findVisibleTeamId(db, f.actors.superAdmin, "00000000-0000-0000-0000-000000000000")).toBeNull();
      expect(await findVisibleTeamId(db, f.actors.superAdmin, "not-a-team")).toBeNull();
      expect(await findVisibleTeamId(db, f.actors.superAdmin, undefined)).toBeNull();
    });
  });

  describe("the other lists raised to 50", () => {
    it("notifications: 50 per page, with the unread filter combined", async () => {
      const userId = f.actors.agent1.id;
      await db.insert(notifications).values(Array.from({ length: 53 }, (_, i) => ({ userId, type: "lead_assigned" as const, title: `N ${pad(i)}`, dedupeKey: `k-${i}`, readAt: i < 2 ? new Date() : null })));
      const first = await listNotifications(db, f.actors.agent1);
      expect(first).toMatchObject({ total: 53, pageCount: 2 });
      expect(first.rows).toHaveLength(50);
      expect((await listNotifications(db, f.actors.agent1, { page: "2" })).rows).toHaveLength(3);
      const unread = await listNotifications(db, f.actors.agent1, { unread: "1" });
      expect(unread).toMatchObject({ total: 51, pageCount: 2 });
      expect((await listNotifications(db, f.actors.agent1, { unread: "1", page: "2" })).rows).toHaveLength(1);
      expect(await db.select().from(notifications).where(eq(notifications.userId, f.actors.agent2.id))).toEqual([]);
    });

    it("performance: 50 agents per page; agents with the same name keep one order across pages", async () => {
      await db.insert(users).values(Array.from({ length: 55 }, (_, i) => ({ name: "Same Name", email: `same${i}@test.local`, role: "agent" as const, passwordHash: "x" })));
      const query = { sort: "agent", dir: "desc" };
      const first = await performanceReport(db, f.actors.superAdmin, query);
      expect(first).toMatchObject({ total: 58, pageCount: 2 });
      expect(first.rows).toHaveLength(50);
      const last = await performanceReport(db, f.actors.superAdmin, { ...query, page: "2" });
      expect(last.rows).toHaveLength(8);
      expect(new Set([...first.rows, ...last.rows].map((r) => r.userId)).size).toBe(58);
      // All rows stay available to the CSV export.
      expect(first.allRows).toHaveLength(58);
    });
  });
});
