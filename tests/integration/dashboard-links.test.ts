import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dashboardData } from "@/modules/dashboard/queries";
import { createLead, markLost } from "@/modules/leads/commands";
import { LEAD_STAGES } from "@/modules/leads/constants";
import { listLeads } from "@/modules/leads/queries";
import { loadActor } from "@/server/auth/session-store";
import { leads, teams, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

// 15:00 in Pakistan: rolling windows start mid-day.
const NOW = new Date("2026-11-20T10:00:00Z");
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const OPEN = LEAD_STAGES.filter((s) => s !== "booked" && s !== "lost_lead").join(",");
const RANGES: Record<string, string>[] = [{ range: "24h" }, { range: "7d" }, { range: "30d" }, { range: "mtd" }, { range: "6m" }, { range: "custom", from: "2026-11-01", to: "2026-11-18" }];

describe.skipIf(!hasTestDb)("FR-010: dashboard tiles open the leads they count (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let team1: string;
  let team2: string;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const rows = await db.select({ id: teams.id, name: teams.name }).from(teams);
    team1 = rows.find((t) => t.name === "Team 1")!.id;
    team2 = rows.find((t) => t.name === "Team 2")!.id;
  });

  const lead = async (owner: Actor, hoursAgo: number, patch: Partial<typeof leads.$inferInsert> = {}, projectId = f.projectId) => {
    const r = await createLead(db, f.actors.superAdmin, leadInput(f, { ownerId: owner.id, projectId }));
    if (r.outcome !== "created") throw new Error("lead");
    await db.update(leads).set({ createdAt: ago(hoursAgo), ...patch }).where(eq(leads.id, r.leadId));
    return r.leadId;
  };
  /** Leads on both sides of every window edge: same day as a rolling start but before it, for two teams. */
  const seedSpread = async () => {
    const { agent1, agent2, outsideAgent } = f.actors;
    await lead(agent1, 1);
    await lead(agent2, 12, { stage: "booked" });
    await lead(outsideAgent, 20, { isRegenerated: true });
    await lead(agent1, 25); // before the 24h window, same calendar day as its start
    await lead(agent1, 26, { stage: "booked" });
    await lead(agent2, 7 * 24 - 2, { isRegenerated: true });
    await lead(outsideAgent, 7 * 24 + 2);
    await lead(agent1, 30 * 24 - 1);
    await lead(agent2, 30 * 24 + 1, { stage: "booked" });
    await lead(outsideAgent, 90 * 24);
    await lead(agent1, 200 * 24);
    await lead(agent1, 2, {}, f.otherProjectId); // another project never counts
    for (const hours of [3, 28, 100]) {
      const id = await lead(agent1, hours);
      await markLost(db, f.actors.superAdmin, id, { lostReasonId: f.lostReasonId });
      await db.update(leads).set({ createdAt: ago(hours) }).where(eq(leads.id, id));
    }
  };
  const tiles = async (actor: Actor, query: Record<string, string>) => {
    const { data } = await dashboardData(db, actor, f.projectId, query, NOW);
    if (!data) throw new Error("no data");
    const total = async (view: string, extra: Record<string, string> = {}) => (await listLeads(db, actor, f.projectId, { ...data.listParams, ...extra, view }, NOW)).total;
    return { data, total };
  };

  it("every tile's number equals its list, for every range", async () => {
    await seedSpread();
    for (const query of RANGES) {
      const { data, total } = await tiles(f.actors.superAdmin, query);
      const label = JSON.stringify(query);
      expect(await total("all"), `total ${label}`).toBe(data.kpis!.totalLeads);
      expect(await total("all", { stage: OPEN }), `open ${label}`).toBe(data.kpis!.openPipeline);
      expect(await total("won"), `won ${label}`).toBe(data.kpis!.won);
      expect(await total("regenerated"), `regenerated ${label}`).toBe(data.kpis!.regenerated);
      expect(await total("lost"), `lost ${label}`).toBe(data.kpis!.lost);
    }
  });

  it("rolling ranges pass the exact window, so a lead just before it is left out; day ranges keep their dates", async () => {
    await seedSpread();
    const rolling = await tiles(f.actors.superAdmin, { range: "24h" });
    expect(rolling.data.listParams).toEqual({ createdFrom: ago(24).toISOString(), createdTo: NOW.toISOString() });
    // Whole days would have counted the leads from 25 and 26 hours ago too.
    const days = (await listLeads(db, f.actors.superAdmin, f.projectId, { from: "2026-11-19", to: "2026-11-20" }, NOW)).total;
    expect(days).toBeGreaterThan(rolling.data.kpis!.totalLeads);

    expect((await tiles(f.actors.superAdmin, { range: "custom", from: "2026-11-01", to: "2026-11-18" })).data.listParams).toEqual({ from: "2026-11-01", to: "2026-11-18" });
    expect((await tiles(f.actors.superAdmin, {})).data.listParams).toEqual({ from: "2026-11-01", to: "2026-11-20" });
  });

  it("the team filter carries through, for every range and tile", async () => {
    await seedSpread();
    for (const query of RANGES) {
      for (const team of [team1, team2]) {
        const { data, total } = await tiles(f.actors.superAdmin, { ...query, team });
        expect(data.listParams?.team).toBe(team);
        expect(await total("all"), `${team} ${JSON.stringify(query)}`).toBe(data.kpis!.totalLeads);
        expect(await total("won")).toBe(data.kpis!.won);
        expect(await total("all", { stage: OPEN })).toBe(data.kpis!.openPipeline);
      }
    }
    const list = await listLeads(db, f.actors.superAdmin, f.projectId, { team: team2 }, NOW);
    expect(list.teamName).toBe("Team 2");
    expect(new Set(list.rows.map((r) => r.ownerId))).toEqual(new Set([f.actors.outsideAgent.id]));
  });

  it("permissions: a team the actor can't use is ignored, lead scope always applies, and a manager's numbers match", async () => {
    await seedSpread();
    const { manager, agent1 } = f.actors;
    // A manager's own team; the same tile numbers as the list.
    const mine = await tiles(manager, { range: "30d", team: team1 });
    expect(mine.data.listParams?.team).toBe(team1);
    expect(await mine.total("all")).toBe(mine.data.kpis!.totalLeads);

    // Another team in the URL: ignored, as on the dashboard. No outside lead is ever listed.
    const other = await listLeads(db, manager, f.projectId, { team: team2 }, NOW);
    expect(other.teamName).toBeNull();
    expect(other.rows.map((r) => r.ownerId)).not.toContain(f.actors.outsideAgent.id);
    expect(other.total).toBe((await listLeads(db, manager, f.projectId, {}, NOW)).total);
    expect((await tiles(manager, { range: "30d", team: team2 })).data.listParams?.team).toBeUndefined();

    // An agent can't filter by team; they see their own leads, on the tile and the list.
    const own = await tiles(agent1, { range: "30d", team: team1 });
    expect(own.data.listParams?.team).toBeUndefined();
    expect(await own.total("all")).toBe(own.data.kpis!.totalLeads);
    expect((await listLeads(db, agent1, f.projectId, { team: team1 }, NOW)).rows.every((r) => r.ownerId === agent1.id)).toBe(true);

    const [u] = await db.insert(users).values({ name: "Acc", email: "acc@test.local", role: "accountant", passwordHash: "x" }).returning();
    const accountant = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    for (const who of [f.actors.hr, accountant]) {
      expect((await dashboardData(db, who, f.projectId, {}, NOW)).data).toBeNull();
      await expect(listLeads(db, who, f.projectId, { team: team1 }, NOW)).rejects.toThrow(AppError);
    }
  });

  it("empty results: a range or team with no leads gives zero on both sides", async () => {
    await lead(f.actors.agent1, 500 * 24);
    const { data, total } = await tiles(f.actors.superAdmin, { range: "24h" });
    expect(data.kpis!.totalLeads).toBe(0);
    for (const view of ["all", "won", "regenerated", "lost"]) expect(await total(view)).toBe(0);
    const [empty] = await db.insert(teams).values({ name: "Empty Team" }).returning({ id: teams.id });
    const none = await tiles(f.actors.superAdmin, { range: "6m", team: empty.id });
    expect(none.data.kpis!.totalLeads).toBe(0);
    expect(await none.total("all")).toBe(0);
  });

  it("the dashboard's formulas are unchanged, and invalid list parameters are ignored", async () => {
    await seedSpread();
    const { kpis } = (await tiles(f.actors.superAdmin, { range: "custom", from: "2026-11-01", to: "2026-11-20" })).data;
    expect(kpis).toMatchObject({ won: 2, lost: 3 });
    expect(kpis!.regenerated).toBe(2); // leads created in the window flagged as re-inquiries, as before
    expect(kpis!.conversionRate).toBeCloseTo(Math.round((2 / kpis!.totalLeads) * 1000) / 10);

    const all = (await listLeads(db, f.actors.superAdmin, f.projectId, {}, NOW)).total;
    for (const bad of [{ createdFrom: "yesterday" }, { createdTo: "'; drop table leads" }, { team: "not-a-team" }, { team: "00000000-0000-4000-8000-000000000000" }]) {
      expect((await listLeads(db, f.actors.superAdmin, f.projectId, bad, NOW)).total).toBe(all);
    }
  });
});
