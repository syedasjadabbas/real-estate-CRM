import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { setTeamLead } from "@/modules/teams/commands";
import { teamAgentKpis } from "@/modules/teams/team-agent";
import { setTarget } from "@/modules/targets/service";
import { businessToday } from "@/modules/bookings/today";
import { loadActor } from "@/server/auth/session-store";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { teams, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

/** A Team Lead opens one of their agents' KPIs from My team (owner, 16 Nov 2026). */
describe.skipIf(!hasTestDb)("Team Lead: one agent's KPIs (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let lead: Actor;
  const reload = (a: Actor) => loadActor(db, { id: a.id, name: a.name, email: a.email, role: a.role });

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [u] = await db.insert(users).values({ name: "Zed Admin", email: "admin@test.local", role: "admin", passwordHash: "x" }).returning();
    const admin = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    const [{ id: teamId }] = await db.select({ id: teams.id }).from(teams).where(eq(teams.name, "Team 1"));
    await setTeamLead(db, admin, teamId, { userId: f.actors.agent1.id });
    await setTarget(db, admin, { userId: f.actors.agent2.id, period: "monthly", anchor: businessToday(new Date()), calls: 20 });
    lead = await reload(f.actors.agent1);
  });

  it("shows a team member's figures, pipeline, targets, attendance and rank", async () => {
    const r = await createLead(db, f.actors.agent2, leadInput(f, { phoneNumber: "0300-5550001" }));
    if (r.outcome !== "created") throw new Error("setup");
    const k = await teamAgentKpis(db, lead, f.actors.agent2.id);
    expect(k.person.id).toBe(f.actors.agent2.id);
    expect(k.pipeline.find((p) => p.stage === "new_lead")?.count).toBe(1);
    expect(k.targets.map((t) => t.period)).toEqual(["monthly"]);
    expect(k.team.size).toBe(2);
    expect(k.metrics).toHaveProperty("winPct");
    expect(k.attendance.month).toHaveProperty("workingDays");
  });

  it("refuses agents outside the team, other agents and Admins", async () => {
    expect(await codeOf(teamAgentKpis(db, lead, f.actors.outsideAgent.id))).toBe("NOT_FOUND");
    expect(await codeOf(teamAgentKpis(db, await reload(f.actors.agent2), f.actors.agent1.id))).toBe("FORBIDDEN");
    expect(await codeOf(teamAgentKpis(db, f.actors.superAdmin, f.actors.agent2.id))).toBe("FORBIDDEN");
  });
});
