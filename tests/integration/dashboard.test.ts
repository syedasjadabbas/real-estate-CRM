import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dashboardData, rangeBounds } from "@/modules/dashboard/queries";
import { createLead } from "@/modules/leads/commands";
import { listLeads } from "@/modules/leads/queries";
import { leads, meetings, teamMembers, users } from "@/server/db/schema";
import { loadActor } from "@/server/auth/session-store";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const DAY = 86_400_000;

describe.skipIf(!hasTestDb)("Dashboard analytics (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;
  let accountant: Actor;
  const now = new Date();

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());

  const lead = async (owner: Actor, set: Partial<typeof leads.$inferInsert> = {}, projectId?: string) => {
    const r = await createLead(db, owner, leadInput(f, projectId ? { projectId } : {}));
    if (r.outcome !== "created") throw new Error("setup");
    if (Object.keys(set).length) await db.update(leads).set(set).where(eq(leads.id, r.leadId));
    return r.leadId;
  };

  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const mk = async (role: "admin" | "accountant", email: string) => {
      const [u] = await db.insert(users).values({ name: role, email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    admin = await mk("admin", "admin@test.local");
    accountant = await mk("accountant", "acc@test.local");

    // agent1 (Team 1): 2 open, 1 won, 1 lost, 1 regenerated + untouched; agent2 (Team 1): 1 lost;
    // outside agent (Team 2): 1 open; one agent1 lead in the other project; one agent1 lead 2 months old.
    const a1 = await lead(f.actors.agent1, { firstTouchAt: now });
    await lead(f.actors.agent1, { isRegenerated: true });
    await lead(f.actors.agent1, { stage: "booked", firstTouchAt: now });
    await lead(f.actors.agent1, { stage: "lost_lead", firstTouchAt: now });
    await lead(f.actors.agent2, { stage: "lost_lead", firstTouchAt: now });
    await lead(f.actors.outsideAgent, { firstTouchAt: now });
    await lead(f.actors.agent1, {}, f.otherProjectId);
    const old = await lead(f.actors.agent1, { createdAt: new Date(now.getTime() - 60 * DAY), updatedAt: new Date(now.getTime() - 20 * DAY) });
    // Meetings: one completed 3 days ago on a1; one cancelled on the old lead.
    await db.insert(meetings).values([
      { title: "Visit", startsAt: new Date(now.getTime() - 3 * DAY), organizerId: f.actors.agent1.id, leadId: a1, status: "completed", completedAt: new Date(now.getTime() - 3 * DAY) },
      { title: "Call", startsAt: new Date(now.getTime() - 2 * DAY), organizerId: f.actors.agent1.id, leadId: old, status: "cancelled", cancelledAt: new Date(now.getTime() - 3 * DAY) },
    ]);
  });

  // Queried a moment after the setup, as a real request would be.
  const get = (actor: Actor, params: Record<string, string> = {}) => dashboardData(db, actor, f.projectId, { range: "30d", ...params }, new Date());

  it("computes the executive KPIs for an admin's whole scope", async () => {
    const r = await get(admin);
    expect(r.allowed).toBe(true);
    expect(r.data!.kpis).toEqual({
      totalLeads: 6,
      openPct: 50,
      wonPct: 16.7,
      lostPct: 33.3,
      conversionRate: 16.7,
      winOnDecided: 33.3,
      openPipeline: 3,
      openPipelinePct: 50,
      won: 1,
      lost: 2,
      attritionPct: 66.7,
      regenerated: 1,
      awaitingFirstTouch: 1,
    });
    expect(r.data!.leadSources).toEqual([expect.objectContaining({ label: "Facebook", count: 6 })]);
    expect(r.data!.inboundChannels).toEqual([{ id: "manual", label: "Manual", count: 6 }]);
    expect(r.data!.topProjects.map((p) => [p.label, p.count])).toEqual([["Test Project", 6], ["Other Project", 1]]);
    expect(r.data!.teams.map((t) => t.name)).toEqual(["Team 1", "Team 2"]);
  });

  it("matches the leads list for the same scope and dates", async () => {
    const day = (d: Date) => new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
    const from = day(new Date(now.getTime() - 10 * DAY));
    const to = day(now);
    for (const actor of [admin, f.actors.manager, f.actors.agent1]) {
      const dash = await dashboardData(db, actor, f.projectId, { range: "custom", from, to }, new Date());
      const list = await listLeads(db, actor, f.projectId, { from, to });
      expect(dash.data!.kpis!.totalLeads).toBe(list.total);
    }
  });

  it("Teams tile: the number of scored teams and the average of their scores, provisional on little history", async () => {
    const all = (await get(admin)).data!;
    expect(all.teamScores.length).toBeGreaterThan(0);
    const mean = Math.round(all.teamScores.reduce((sum, t) => sum + t.count, 0) / all.teamScores.length);
    expect(all.teamSummary).toEqual({ teams: all.teamScores.length, avgScore: mean, provisional: true });
    // A manager's tile covers only the teams they manage, matching their Team performance panel.
    const mine = (await get(f.actors.manager)).data!;
    expect(mine.teamScores.map((t) => t.label)).toEqual(["Team 1"]);
    expect(mine.teamSummary).toMatchObject({ teams: 1, avgScore: mine.teamScores[0].count });
    // No active agents: nothing to average, so no number is shown (not a made-up 0).
    await db.update(users).set({ status: "inactive" }).where(eq(users.role, "agent"));
    expect((await get(admin)).data!.teamSummary).toEqual({ teams: 0, avgScore: null, provisional: false });
  });

  it("limits agents to their own leads and managers to their teams; HR and accountants see none", async () => {
    expect((await get(f.actors.agent1)).data!.kpis!.totalLeads).toBe(4);
    expect((await get(f.actors.agent1)).data!.teams).toEqual([]);
    expect((await get(f.actors.manager)).data!.kpis!.totalLeads).toBe(5);
    expect((await get(f.actors.manager)).data!.teams.map((t) => t.name)).toEqual(["Team 1"]);
    for (const actor of [f.actors.hr, accountant]) {
      const r = await get(actor);
      expect(r).toMatchObject({ data: null, allowed: false });
    }
    expect((await dashboardData(db, admin, null, {}, now)).data).toBeNull();
  });

  it("filters by team only within the actor's own teams", async () => {
    const [team2] = (await get(admin)).data!.teams.filter((t) => t.name === "Team 2");
    expect((await get(admin, { team: team2.id })).data!.kpis!.totalLeads).toBe(1);
    // A manager cannot pick another team: the parameter is ignored.
    const r = await get(f.actors.manager, { team: team2.id });
    expect(r.query.team).toBeUndefined();
    expect(r.data!.kpis!.totalLeads).toBe(5);
  });

  it("applies the ranges", async () => {
    expect((await get(admin, { range: "6m" })).data!.kpis!.totalLeads).toBe(7);
    expect((await get(admin, { range: "7d" })).data!.kpis!.totalLeads).toBe(6);
    // Bad custom dates fall back to month to date; unknown ranges to MTD.
    expect((await get(admin, { range: "custom", from: "2026-12-01", to: "2026-01-01" })).query.range).toBe("mtd");
    expect((await get(admin, { range: "forever" })).query.range).toBe("mtd");
  });

  it("reports pipeline health: stale, no meeting in 30 days, meetings done", async () => {
    const health = (await get(admin)).data!.pipelineHealth!;
    // Open leads in the project: a1, regenerated, outside, old. Old is stale (20 days without update).
    expect(health.stale).toBe(1);
    // a1 had a meeting; the others did not (the old lead's meeting was cancelled).
    expect(health.noMeeting).toBe(3);
    expect(health.meetingsDone).toBe(1);
    expect(health.rows).toEqual([]);
  });

  it("works out range bounds in Pakistan time", () => {
    const at = new Date("2026-10-31T20:00:00Z"); // 1 Nov 01:00 in Karachi
    expect(rangeBounds({ range: "mtd" }, at).start.toISOString()).toBe("2026-10-31T19:00:00.000Z");
    const custom = rangeBounds({ range: "custom", from: "2026-10-01", to: "2026-10-31" }, at);
    expect([custom.start.toISOString(), custom.end.toISOString()]).toEqual(["2026-09-30T19:00:00.000Z", "2026-10-31T19:00:00.000Z"]);
  });

  it("ignores deleted leads", async () => {
    const ids = (await db.select({ id: leads.id }).from(leads).where(eq(leads.stage, "booked"))).map((r) => r.id);
    await db.update(leads).set({ deletedAt: now }).where(inArray(leads.id, ids));
    expect((await get(admin)).data!.kpis!.won).toBe(0);
  });

  it("breaks lost leads down by team, with the owners inside each team", async () => {
    const r = await get(admin);
    const lost = r.data!.lost!;
    expect(lost).not.toHaveProperty("byReason");
    expect(r.data!).not.toHaveProperty("recentLeads");
    expect(lost.byTeam).toEqual([
      { id: expect.any(String), label: "Team 1", count: 2, agents: [expect.objectContaining({ label: "Agent A", count: 1 }), expect.objectContaining({ label: "Agent B", count: 1 })] },
    ]);
    // Scope applies: agent1 only sees their own lost lead.
    expect((await get(f.actors.agent1)).data!.lost!.byTeam.reduce((n, t) => n + t.count, 0)).toBe(1);
    // An owner in no team is grouped under "No team".
    await lead(f.actors.outsideAgent, { stage: "lost_lead", firstTouchAt: now });
    await db.delete(teamMembers).where(eq(teamMembers.userId, f.actors.outsideAgent.id));
    expect((await get(admin)).data!.lost!.byTeam.at(-1)).toMatchObject({ id: "none", label: "No team", count: 1 });
  });
});
