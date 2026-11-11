import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { performanceContexts, performanceCsv, performanceReport } from "@/modules/performance/service";
import { loadActor } from "@/server/auth/session-store";
import { followUps, leadActivities, leads, meetings, signinLogs, teams, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

// Range 1–29 Oct 2026 in Pakistan time = [2026-09-30T19:00Z, 2026-10-29T19:00Z).
const NOW = new Date("2026-10-29T05:00:00Z");
const RANGE = { from: "2026-10-01", to: "2026-10-29" };
const INSIDE = new Date("2026-10-10T07:00:00Z");
const FIRST_MOMENT = new Date("2026-09-30T19:00:00Z");
const JUST_BEFORE = new Date("2026-09-30T18:59:59Z");
const LAST_MOMENT = new Date("2026-10-29T18:59:59Z");
const JUST_AFTER = new Date("2026-10-29T19:00:00Z");

describe.skipIf(!hasTestDb)("Performance (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let team1: string;
  let accountant: Actor;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    team1 = (await db.select().from(teams).where(eq(teams.name, "Team 1")))[0].id;
    const [u] = await db.insert(users).values({ name: "Acc", email: "acc@test.local", role: "accountant", passwordHash: "x" }).returning();
    accountant = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  });

  /** A lead owned by `owner`, created at `at`, in `stage`. */
  const lead = async (owner: Actor, at: Date, stage: (typeof leads.$inferSelect)["stage"] = "new_lead", deleted = false) => {
    const r = await createLead(db, owner, leadInput(f));
    if (r.outcome !== "created") throw new Error("setup");
    await db.update(leads).set({ createdAt: at, stage, deletedAt: deleted ? new Date() : null }).where(eq(leads.id, r.leadId));
    return r.leadId;
  };
  const followUp = (leadId: string, assigneeId: string, dueAt: Date, status: "pending" | "done" | "cancelled") =>
    db.insert(followUps).values({ leadId, assigneeId, dueAt, status, doneAt: status === "done" ? dueAt : null });
  const meeting = (leadId: string, organizerId: string, startsAt: Date, status: "scheduled" | "completed" | "cancelled") =>
    db.insert(meetings).values({
      title: "M",
      leadId,
      organizerId,
      startsAt,
      status,
      completedAt: status === "completed" ? startsAt : null,
      cancelledAt: status === "cancelled" ? startsAt : null,
    });
  const signIn = (userId: string, at: Date, event: "sign_in" | "sign_out") => db.insert(signinLogs).values({ userId, at, event });
  const row = (report: Awaited<ReturnType<typeof performanceReport>>, userId: string) => report.allRows.find((r) => r.userId === userId)!;

  it("computes every metric from records inside the range only (boundaries inclusive / exclusive)", async () => {
    const a = f.actors.agent1;
    const l1 = await lead(a, FIRST_MOMENT); // open, first moment of the range
    await lead(a, LAST_MOMENT, "booked");
    await lead(a, INSIDE, "lost_lead");
    await lead(a, INSIDE, "lost_lead");
    await lead(a, INSIDE, "meeting_done"); // open
    await lead(a, JUST_BEFORE, "booked"); // outside
    await lead(a, JUST_AFTER); // outside
    await lead(a, INSIDE, "new_lead", true); // deleted
    await lead(f.actors.agent2, INSIDE, "booked"); // another agent
    await followUp(l1, a.id, INSIDE, "done");
    await followUp(l1, a.id, INSIDE, "done");
    await followUp(l1, a.id, INSIDE, "pending");
    await followUp(l1, a.id, INSIDE, "cancelled"); // not counted
    await followUp(l1, a.id, JUST_AFTER, "done"); // outside
    await meeting(l1, a.id, INSIDE, "completed");
    await meeting(l1, a.id, LAST_MOMENT, "completed");
    await meeting(l1, a.id, INSIDE, "scheduled"); // not completed
    await meeting(l1, a.id, JUST_BEFORE, "completed"); // outside
    await signIn(a.id, INSIDE, "sign_in");
    await signIn(a.id, INSIDE, "sign_in");
    await signIn(a.id, INSIDE, "sign_out");
    await signIn(a.id, JUST_AFTER, "sign_in"); // outside

    const report = await performanceReport(db, f.actors.superAdmin, RANGE, NOW);
    expect(row(report, a.id)).toEqual({
      userId: a.id,
      name: "Agent A",
      leads: 5,
      open: 2,
      booked: 1,
      lost: 2,
      winPct: 33,
      calls: 0,
      callMin: null,
      callsTimed: 0,
      callsVerified: 0,
      callsQualified: 0,
      callSeconds: 0,
      fuDue: 3,
      fuDone: 2,
      fuPct: 67,
      meetings: 2,
      signIns: 2,
      signOuts: 1,
      avgFirstTouchMs: null,
    });
    expect(row(report, f.actors.agent2.id)).toMatchObject({ leads: 1, booked: 1, winPct: 100, fuPct: null });
    expect(report.summary).toMatchObject({ agents: 3, open: 2, booked: 2, lost: 2, winPct: 50, fuDue: 3, fuDone: 2, fuPct: 67, meetings: 2, signIns: 2 });
    expect(report.charts.outcomeMix).toEqual({ open: 2, booked: 2, lost: 2, total: 6 });
    expect(report.charts.topClosers.map((t) => t.name)).toEqual(["Agent B", "Agent A"]);
  });

  it("Q25: leads count by their original assignment date, not a later reassignment", async () => {
    const a = f.actors.agent1;
    // Created in range for agent A, reassigned after the range to agent B: still counts in range (for its owner, B).
    const moved = await lead(a, INSIDE);
    await db.update(leads).set({ ownerId: f.actors.agent2.id }).where(eq(leads.id, moved));
    await db.insert(leadActivities).values({ leadId: moved, actorId: f.actors.manager.id, type: "assignment", data: { mode: "manual", from: a.id, ownerId: f.actors.agent2.id }, createdAt: JUST_AFTER });
    // Created before the range without an owner, first assigned inside it: counts in range.
    const late = await lead(a, JUST_BEFORE);
    await db.insert(leadActivities).values({ leadId: late, actorId: f.actors.manager.id, type: "assignment", data: { mode: "manual", from: null, ownerId: a.id }, createdAt: INSIDE });
    const report = await performanceReport(db, f.actors.superAdmin, RANGE, NOW);
    expect(row(report, f.actors.agent2.id)).toMatchObject({ leads: 1 });
    expect(row(report, a.id)).toMatchObject({ leads: 1 });
  });

  it("scope: admins all agents (or one team), managers their team, agents themselves; HR / accountant denied", async () => {
    const all = await performanceReport(db, f.actors.superAdmin, RANGE, NOW);
    expect(all.allRows.map((r) => r.name)).toEqual(["Agent A", "Agent B", "Agent Outside"]);
    expect(all.context).toBe("all");
    const oneTeam = await performanceReport(db, f.actors.superAdmin, { ...RANGE, team: team1 }, NOW);
    expect(oneTeam.allRows.map((r) => r.name)).toEqual(["Agent A", "Agent B"]);
    const mgr = await performanceReport(db, f.actors.manager, RANGE, NOW);
    expect(mgr.allRows.map((r) => r.name)).toEqual(["Agent A", "Agent B"]);
    expect(mgr.context).toBe("my_teams");
    const otherTeam = (await db.select().from(teams).where(eq(teams.name, "Team 2")))[0].id;
    expect(await errorCode(performanceReport(db, f.actors.manager, { ...RANGE, team: otherTeam }, NOW))).toBe("FORBIDDEN");
    const own = await performanceReport(db, f.actors.agent1, { ...RANGE, team: team1 }, NOW);
    expect(own.allRows.map((r) => r.name)).toEqual(["Agent A"]);
    expect(own.context).toBe("own");
    expect(await errorCode(performanceReport(db, f.actors.hr, RANGE, NOW))).toBe("FORBIDDEN");
    expect(await errorCode(performanceReport(db, accountant, RANGE, NOW))).toBe("FORBIDDEN");
    expect((await performanceContexts(db, f.actors.manager)).map((t) => t.name)).toEqual(["Team 1"]);
    expect((await performanceContexts(db, f.actors.superAdmin)).length).toBe(2);
    expect(await performanceContexts(db, f.actors.agent1)).toEqual([]);
  });

  it("inactive agents are left out; a manager with no team sees no one", async () => {
    await db.update(users).set({ status: "inactive" }).where(eq(users.id, f.actors.agent2.id));
    expect((await performanceReport(db, f.actors.manager, RANGE, NOW)).allRows.map((r) => r.name)).toEqual(["Agent A"]);
    await db.update(teams).set({ managerId: null }).where(eq(teams.id, team1));
    const reloaded = await loadActor(db, { id: f.actors.manager.id, name: "Manager", email: "manager@test.local", role: "manager" });
    expect((await performanceReport(db, reloaded, RANGE, NOW)).total).toBe(0);
  });

  it("sorts (missing % last), paginates, defaults the range and exports CSV", async () => {
    await lead(f.actors.agent2, INSIDE, "booked");
    await lead(f.actors.agent1, INSIDE, "lost_lead");
    const byWin = await performanceReport(db, f.actors.superAdmin, { ...RANGE, sort: "winPct", dir: "desc" }, NOW);
    expect(byWin.rows.map((r) => [r.name, r.winPct])).toEqual([["Agent B", 100], ["Agent A", 0], ["Agent Outside", null]]);
    const asc = await performanceReport(db, f.actors.superAdmin, { ...RANGE, sort: "winPct", dir: "asc" }, NOW);
    expect(asc.rows.at(-1)?.name).toBe("Agent Outside");
    expect((await performanceReport(db, f.actors.superAdmin, {}, NOW)).range).toEqual({ from: "2026-09-29", to: "2026-10-29" });
    const csv = performanceCsv(byWin).split("\n");
    expect(csv[0]).toBe("Agent,From,To,Open leads,Booked,Lost,Win %,Calls,Call min,F/U due,F/U done,F/U %,Meetings,CRM sign-ins,CRM sign-outs,Avg first touch (min)");
    expect(csv[1]).toBe("Agent B,2026-10-01,2026-10-29,0,1,0,100,0,,0,0,,0,0,0,");
    expect(byWin.page).toBe(1);
    expect(byWin.pageCount).toBe(1);
  });
});
