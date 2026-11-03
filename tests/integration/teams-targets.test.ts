import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "@/modules/bookings/commands";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { completeMeeting, createMeeting } from "@/modules/meetings/commands";
import { listTargets, setTarget, targetsCsv } from "@/modules/targets/service";
import { createTeam, saveDailyReport, saveRoster, setTeamMembers, updateTeam } from "@/modules/teams/commands";
import { getDailyReport, getRosterDay, getRosterMonth, listDailyReports, myRoster, teamDetail, teamTiles, visibleTeams } from "@/modules/teams/queries";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, bookings, dailyReports, rosterEntries, targets, teams, users } from "@/server/db/schema";
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
const fieldOf = async (p: Promise<unknown>) => Object.keys((await errorOf(p))?.fields ?? {})[0] ?? null;

// A fixed "now": 29 Oct 2026, 10:00 Pakistan time (before the 11:00 roster lock).
const NOW = new Date("2026-10-29T05:00:00Z");
const TODAY = "2026-10-29";
const AFTER_11 = new Date("2026-10-29T07:00:00Z");

describe.skipIf(!hasTestDb)("Teams & Targets (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let team1: string;
  let team2: string;
  let admin: Actor;
  let accountant: Actor;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    team1 = (await db.select().from(teams).where(eq(teams.name, "Team 1")))[0].id;
    team2 = (await db.select().from(teams).where(eq(teams.name, "Team 2")))[0].id;
    const mk = async (role: "admin" | "accountant", email: string) => {
      const [u] = await db.insert(users).values({ name: role, email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    admin = await mk("admin", "admin@test.local");
    accountant = await mk("accountant", "acc@test.local");
  });

  const line = (agentId: string, n = 1) => ({ agentId, leads: n, calls: n * 10, meetings: n, tokens: 0, bookings: 0, remarks: "ok" });

  describe("teams", () => {
    it("admins create and edit teams; names unique (any case); manager must be a manager; audited", async () => {
      const { teamId } = await createTeam(db, admin, { name: "North", managerId: f.actors.manager.id });
      expect(await fieldOf(createTeam(db, admin, { name: "north" }))).toBe("name");
      expect(await fieldOf(createTeam(db, admin, { name: "South", managerId: f.actors.agent1.id }))).toBe("managerId");
      expect(await errorCode(createTeam(db, f.actors.manager, { name: "Mine" }))).toBe("FORBIDDEN");
      expect(await errorCode(createTeam(db, f.actors.hr, { name: "HR team" }))).toBe("FORBIDDEN");
      expect((await updateTeam(db, f.actors.superAdmin, teamId, { isActive: false, name: "North Zone" })).changed.sort()).toEqual(["isActive", "name"]);
      expect((await db.select().from(teams).where(eq(teams.id, teamId)))[0]).toMatchObject({ isActive: false, name: "North Zone" });
      expect((await db.select().from(auditLogs).where(eq(auditLogs.entityId, teamId))).map((a) => a.action).sort()).toEqual(["team.create", "team.update"]);
    });

    it("Q9: each team keeps its own weekend days, shown with the roster", async () => {
      const { teamId } = await createTeam(db, admin, { name: "Weekend Fri-Sat", weekendDays: [6, 5, 5] });
      expect((await db.select().from(teams).where(eq(teams.id, teamId)))[0].weekendDays).toEqual([5, 6]);
      expect(await updateTeam(db, admin, teamId, { weekendDays: [0] })).toEqual({ changed: ["weekendDays"] });
      expect(await updateTeam(db, admin, teamId, { weekendDays: [0] })).toEqual({ changed: [] });
      expect(await fieldOf(updateTeam(db, admin, teamId, { weekendDays: [7] }))).toBe("weekendDays.0");
      expect(await fieldOf(updateTeam(db, admin, teamId, { weekendDays: [0, 1, 2, 3, 4, 5, 6] }))).toBe("weekendDays");
      expect((await getRosterMonth(db, admin, teamId, "2026-11")).team.weekendDays).toEqual([0]);
    });

    it("membership: admins only, active agents / managers only, add and remove recorded", async () => {
      const r = await setTeamMembers(db, admin, team1, { userIds: [f.actors.manager.id, f.actors.agent1.id, f.actors.outsideAgent.id] });
      expect(r).toEqual({ added: [f.actors.outsideAgent.id], removed: [f.actors.agent2.id] });
      expect(await fieldOf(setTeamMembers(db, admin, team1, { userIds: [f.actors.hr.id] }))).toBe("userIds");
      expect(await errorCode(setTeamMembers(db, f.actors.manager, team1, { userIds: [] }))).toBe("FORBIDDEN");
      const detail = await teamDetail(db, admin, team1);
      expect(detail.members.map((m) => m.id).sort()).toEqual([f.actors.manager.id, f.actors.agent1.id, f.actors.outsideAgent.id].sort());
      expect(detail.history[0].action).toBe("team.members");
    });

    it("visibility: admins and HR see all teams, managers their own, agents and accountants none", async () => {
      expect((await visibleTeams(db, admin)).length).toBe(2);
      expect((await visibleTeams(db, f.actors.hr)).length).toBe(2);
      expect((await visibleTeams(db, f.actors.manager)).map((t) => t.id)).toEqual([team1]);
      expect(await errorCode(visibleTeams(db, f.actors.agent1))).toBe("FORBIDDEN");
      expect(await errorCode(visibleTeams(db, accountant))).toBe("FORBIDDEN");
      expect(await errorCode(teamDetail(db, f.actors.manager, team2))).toBe("FORBIDDEN");
      expect(await teamTiles(db, admin)).toEqual({ teams: 2, active: 2, inactive: 0, members: 4 });
    });
  });

  describe("daily report", () => {
    it("the manager enters today's report; saving again updates the same report; totals listed date-wise", async () => {
      await saveDailyReport(db, f.actors.manager, team1, TODAY, { lines: [line(f.actors.agent1.id), line(f.actors.agent2.id, 2)] }, NOW);
      await saveDailyReport(db, f.actors.manager, team1, TODAY, { lines: [line(f.actors.agent1.id, 3)] }, NOW);
      expect((await db.select().from(dailyReports)).length).toBe(1);
      const report = await getDailyReport(db, f.actors.manager, team1, TODAY, NOW);
      expect(report.canEdit).toBe(true);
      expect(report.rows.find((r) => r.agentId === f.actors.agent1.id)).toMatchObject({ leads: 3, calls: 30 });
      expect(report.rows.find((r) => r.agentId === f.actors.agent2.id)).toMatchObject({ leads: 0 });
      const list = await listDailyReports(db, admin, {}, NOW);
      expect(list.from).toBe("2026-10-15");
      expect(list.rows).toHaveLength(1);
      expect(list.rows[0]).toMatchObject({ teamName: "Team 1", agents: 1, leads: 3, calls: 30 });
      expect((await db.select().from(auditLogs).where(eq(auditLogs.entity, "daily_report"))).map((a) => a.action).sort()).toEqual(["daily_report.create", "daily_report.update"]);
    });

    it("same-day lock, team scope, members only, read-only roles", async () => {
      expect(await errorCode(saveDailyReport(db, f.actors.manager, team1, "2026-10-28", { lines: [] }, NOW))).toBe("BUSINESS_RULE");
      expect(await errorCode(saveDailyReport(db, f.actors.manager, team2, TODAY, { lines: [] }, NOW))).toBe("FORBIDDEN");
      expect(await fieldOf(saveDailyReport(db, f.actors.manager, team1, TODAY, { lines: [line(f.actors.outsideAgent.id)] }, NOW))).toBe("lines");
      expect(await fieldOf(saveDailyReport(db, f.actors.manager, team1, TODAY, { lines: [line(f.actors.manager.id)] }, NOW))).toBe("lines");
      expect(await errorCode(saveDailyReport(db, f.actors.hr, team1, TODAY, { lines: [] }, NOW))).toBe("FORBIDDEN");
      expect(await errorCode(saveDailyReport(db, admin, team2, TODAY, { lines: [line(f.actors.outsideAgent.id)] }, NOW))).toBe("ok");
      expect((await getDailyReport(db, f.actors.hr, team2, TODAY, NOW)).canEdit).toBe(false);
      expect((await listDailyReports(db, f.actors.manager, {}, NOW)).rows).toHaveLength(0);
      expect(await errorCode(listDailyReports(db, f.actors.agent1, {}, NOW))).toBe("FORBIDDEN");
      expect((await getDailyReport(db, f.actors.manager, team1, "2026-10-28", NOW)).canEdit).toBe(false);
    });
  });

  describe("duty roster", () => {
    it("saves statuses; null clears; counters; month view; agents see only their own", async () => {
      await saveRoster(db, f.actors.manager, team1, TODAY, { entries: [{ userId: f.actors.agent1.id, status: "in_office" }, { userId: f.actors.agent2.id, status: "leads_off" }] }, NOW);
      await saveRoster(db, f.actors.manager, team1, "2026-10-30", { entries: [{ userId: f.actors.agent1.id, status: "on_leave" }] }, NOW);
      const day = await getRosterDay(db, f.actors.manager, team1, TODAY, NOW);
      expect(day.counts).toEqual({ in_office: 1, on_site: 0, on_leave: 0, leads_off: 1 });
      expect(day.canEdit).toBe(true);
      await saveRoster(db, f.actors.manager, team1, TODAY, { entries: [{ userId: f.actors.agent2.id, status: null }] }, NOW);
      expect((await getRosterDay(db, f.actors.manager, team1, TODAY, NOW)).counts.leads_off).toBe(0);
      const month = await getRosterMonth(db, f.actors.hr, team1, "2026-10");
      expect(month.rows.find((r) => r.id === f.actors.agent1.id)?.byDay).toEqual({ "2026-10-29": "in_office", "2026-10-30": "on_leave" });
      const mine = await myRoster(db, f.actors.agent1, "2026-10");
      expect(mine.entries.map((e) => e.status)).toEqual(["in_office", "on_leave"]);
      expect(await errorCode(myRoster(db, f.actors.manager, "2026-10"))).toBe("FORBIDDEN");
      expect(await errorCode(getRosterDay(db, f.actors.agent1, team1, TODAY, NOW))).toBe("FORBIDDEN");
      expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "roster.save"))).length).toBe(3);
    });

    it("locked after 11:00 and for past days; members only; operate scope", async () => {
      expect(await errorCode(saveRoster(db, f.actors.manager, team1, TODAY, { entries: [] }, AFTER_11))).toBe("BUSINESS_RULE");
      expect(await errorCode(saveRoster(db, admin, team1, "2026-10-28", { entries: [] }, NOW))).toBe("BUSINESS_RULE");
      expect((await getRosterDay(db, f.actors.manager, team1, TODAY, AFTER_11)).locked).toBe(true);
      expect(await fieldOf(saveRoster(db, f.actors.manager, team1, TODAY, { entries: [{ userId: f.actors.outsideAgent.id, status: "on_site" }] }, NOW))).toBe("entries");
      expect(await errorCode(saveRoster(db, f.actors.manager, team2, TODAY, { entries: [] }, NOW))).toBe("FORBIDDEN");
      expect(await errorCode(saveRoster(db, f.actors.hr, team1, TODAY, { entries: [] }, NOW))).toBe("FORBIDDEN");
      expect((await db.select().from(rosterEntries)).length).toBe(0);
    });
  });

  describe("targets", () => {
    const set = (actor: Actor, userId: string, extra: Record<string, unknown> = {}) =>
      setTarget(db, actor, { userId, period: "monthly", anchor: "2026-10-17", calls: "1300", meetings: "20", soldSqft: "350", ...extra });

    it("set by admins and team managers, normalised to the period start; zeros clear; audited", async () => {
      expect((await set(admin, f.actors.agent1.id)).periodStart).toBe("2026-10-01");
      expect((await set(f.actors.manager, f.actors.agent1.id, { meetings: "25" })).changed).toBe(true);
      expect((await set(f.actors.manager, f.actors.agent1.id, { meetings: "25" })).changed).toBe(false);
      expect((await db.select().from(targets))[0]).toMatchObject({ meetings: 25, periodStart: "2026-10-01" });
      expect((await setTarget(db, admin, { userId: f.actors.agent2.id, period: "weekly", anchor: "2026-10-01", calls: 5 })).periodStart).toBe("2026-09-28");
      expect(await errorCode(set(f.actors.manager, f.actors.outsideAgent.id))).toBe("FORBIDDEN");
      expect(await errorCode(set(f.actors.agent1, f.actors.agent1.id))).toBe("FORBIDDEN");
      expect(await fieldOf(set(admin, f.actors.manager.id))).toBe("userId");
      expect((await set(admin, f.actors.agent1.id, { calls: 0, meetings: 0, soldSqft: 0 })).cleared).toBe(true);
      expect((await db.select().from(targets).where(eq(targets.userId, f.actors.agent1.id))).length).toBe(0);
      expect((await db.select().from(auditLogs).where(eq(auditLogs.entity, "target"))).map((a) => a.action).sort()).toEqual(["target.clear", "target.create", "target.create", "target.update"]);
    });

    it("grid scope: admins all agents, managers their team's, agents themselves; HR / accountant none", async () => {
      await set(admin, f.actors.agent1.id);
      const q = { period: "monthly", anchor: "2026-10-01" };
      expect((await listTargets(db, admin, q, NOW)).rows.map((r) => r.name).sort()).toEqual(["Agent A", "Agent B", "Agent Outside"]);
      const mgr = await listTargets(db, f.actors.manager, q, NOW);
      expect(mgr.rows.map((r) => r.name)).toEqual(["Agent A", "Agent B"]);
      expect(mgr.rows.every((r) => r.canEdit)).toBe(true);
      const own = await listTargets(db, f.actors.agent1, q, NOW);
      expect(own.rows).toHaveLength(1);
      expect(own.rows[0]).toMatchObject({ name: "Agent A", target: { calls: 1300, meetings: 20, soldSqft: 350 }, canEdit: false });
      expect(await errorCode(listTargets(db, f.actors.hr, q, NOW))).toBe("FORBIDDEN");
      expect(await errorCode(listTargets(db, accountant, q, NOW))).toBe("FORBIDDEN");
    });

    it("achievement: completed meetings organised in the window and sq ft of bookings confirmed in it; calls unavailable", async () => {
      await set(admin, f.actors.agent1.id);
      const r = await createLead(db, f.actors.agent1, leadInput(f));
      if (r.outcome !== "created") throw new Error("setup");
      const inOct = new Date("2026-10-10T07:00:00Z").toISOString();
      const done = await createMeeting(db, f.actors.agent1, { title: "Visit", startsAt: inOct, leadId: r.leadId, moveLead: false });
      await completeMeeting(db, f.actors.agent1, done.meetingId, { moveLead: false });
      await createMeeting(db, f.actors.agent1, { title: "Still scheduled", startsAt: inOct, leadId: r.leadId, moveLead: false });
      const nov = await createMeeting(db, f.actors.agent1, { title: "Next month", startsAt: "2026-11-02T07:00:00Z", leadId: r.leadId, moveLead: false });
      await completeMeeting(db, f.actors.agent1, nov.meetingId, { moveLead: false });
      const unitId = (await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "T-1", areaSqft: "500", basePrice: "1000000" })).unitId;
      const { bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: r.leadId, unitId, ratePerSqft: "2000", tokenAmount: "1000" });
      await db.update(bookings).set({ stage: "confirmed", confirmedAt: new Date("2026-10-20T06:00:00Z") }).where(eq(bookings.id, bookingId));
      const grid = await listTargets(db, f.actors.manager, { period: "monthly", anchor: "2026-10-05" }, NOW);
      const a = grid.rows.find((x) => x.userId === f.actors.agent1.id)!;
      expect(a.achieved).toEqual({ calls: null, meetings: 1, soldSqft: 500 });
      expect(a.percent).toEqual({ calls: null, meetings: 5, soldSqft: 142 });
      const csv = targetsCsv(grid);
      expect(csv.split("\n")[0]).toContain("Calls achieved");
      expect(csv).toContain("Agent A,monthly,2026-10-01,1300,,20,1,350,500");
      const weekly = await listTargets(db, admin, { period: "weekly", anchor: "2026-10-21" }, NOW);
      expect(weekly.rows.find((x) => x.userId === f.actors.agent1.id)).toMatchObject({ target: null, achieved: { meetings: 0, soldSqft: 500 } });
    });

    it("database constraints: weekly must start Monday, monthly the 1st, values non-negative, one per period", async () => {
      const base = { userId: f.actors.agent1.id, calls: 1, meetings: 1, soldSqft: 1 };
      await expect(db.insert(targets).values({ ...base, period: "weekly", periodStart: "2026-10-01" })).rejects.toThrow();
      await expect(db.insert(targets).values({ ...base, period: "monthly", periodStart: "2026-10-02" })).rejects.toThrow();
      await expect(db.insert(targets).values({ ...base, period: "daily", periodStart: "2026-10-02", calls: -1 })).rejects.toThrow();
      await db.insert(targets).values({ ...base, period: "daily", periodStart: "2026-10-02" });
      await expect(db.insert(targets).values({ ...base, period: "daily", periodStart: "2026-10-02" })).rejects.toThrow();
      await expect(db.insert(dailyReports).values([{ teamId: team1, reportDate: TODAY }, { teamId: team1, reportDate: TODAY }])).rejects.toThrow();
      expect((await db.select().from(targets).where(and(eq(targets.userId, f.actors.agent1.id)))).length).toBe(1);
    });
  });
});
