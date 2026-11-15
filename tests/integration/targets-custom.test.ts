import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { currentTargets, listTargets, setTarget, targetsCsv, targetsMetFor } from "@/modules/targets/service";
import { loadActor } from "@/server/auth/session-store";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { meetings, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";
import { createLead } from "@/modules/leads/commands";
import { dashboardData } from "@/modules/dashboard/queries";

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
};

describe.skipIf(!hasTestDb)("Custom-period targets (15 Nov 2026)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;
  const NOW = new Date("2026-11-20T10:00:00+05:00");

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

  it("sets a target for any From–To dates and counts achievement inside them only", async () => {
    const a = f.actors.agent1;
    expect((await errorOf(setTarget(db, admin, { userId: a.id, period: "custom", anchor: "2026-11-10", meetings: 2 })))?.fields?.to).toMatch(/last day/);
    expect((await errorOf(setTarget(db, admin, { userId: a.id, period: "custom", anchor: "2026-11-10", to: "2026-11-09", meetings: 2 })))?.fields?.to).toMatch(/last day/);
    expect((await errorOf(setTarget(db, admin, { userId: a.id, period: "custom", anchor: "2026-01-01", to: "2027-06-01", meetings: 2 })))?.fields?.to).toMatch(/at most a year/);
    await setTarget(db, admin, { userId: a.id, period: "custom", anchor: "2026-11-10", to: "2026-11-25", meetings: 2, calls: 0, soldSqft: 0 });

    // Completed meetings on the 12th and 22nd count; the one on the 26th is outside the period.
    const lead = await createLead(db, a, leadInput(f));
    if (lead.outcome !== "created") throw new Error("setup");
    for (const day of ["12", "22", "26"]) {
      await db.insert(meetings).values({ title: "Visit", startsAt: new Date(`2026-11-${day}T11:00:00+05:00`), organizerId: a.id, leadId: lead.leadId, status: "completed", completedAt: new Date(`2026-11-${day}T12:00:00+05:00`) });
    }
    const grid = await listTargets(db, admin, { period: "custom", anchor: "2026-11-10", to: "2026-11-25" }, NOW);
    expect(grid).toMatchObject({ period: "custom", periodStart: "2026-11-10", periodEnd: "2026-11-25" });
    expect(grid.rows.find((r) => r.userId === a.id)).toMatchObject({ target: { meetings: 2 }, achieved: { meetings: 2 }, met: ["meetings"] });
    expect(targetsCsv(grid)).toContain(`${a.name},custom,2026-11-10,2026-11-25,0,0,2,2`);

    // It shows among the agent's current targets while it runs, and counts in Performance.
    const now = await currentTargets(db, a.id, NOW);
    expect(now.find((t) => t.period === "custom")).toMatchObject({ start: "2026-11-10", end: "2026-11-25", met: ["meetings"] });
    expect((await targetsMetFor(db, [a.id], "2026-11-01", "2026-11-30")).get(a.id)).toEqual({ met: 1, set: 1 });
    expect((await currentTargets(db, a.id, new Date("2026-11-28T10:00:00+05:00"))).some((t) => t.period === "custom")).toBe(false);
    // The agent's dashboard "My Targets" card lists it while it runs.
    const dash = (await dashboardData(db, a, f.projectId, {}, NOW)).data!;
    expect(dash.targets?.custom).toEqual([{ start: "2026-11-10", end: "2026-11-25", lines: expect.arrayContaining([expect.objectContaining({ label: "Meetings", actual: 2, target: 2, met: true })]) }]);
  });

  it("adds custom goals with hand-entered progress, searches agents, and clears only when nothing is left", async () => {
    const a = f.actors.agent1;
    const base = { userId: a.id, period: "monthly", anchor: "2026-11-01", calls: 0, meetings: 0, soldSqft: 0 };
    expect((await errorOf(setTarget(db, admin, { ...base, custom: [{ name: "Brochures", goal: 50, achieved: 0 }, { name: "brochures", goal: 5, achieved: 0 }] })))?.fields?.custom).toMatch(/different name/);
    expect((await errorOf(setTarget(db, admin, { ...base, custom: [{ name: "Brochures", goal: 0, achieved: 0 }] })))?.fields?.["custom.0.goal"]).toMatch(/above 0/);
    // A target with only a custom goal is kept.
    expect(await setTarget(db, admin, { ...base, custom: [{ name: "Brochures delivered", goal: 50, achieved: 20 }] })).toMatchObject({ changed: true, cleared: false });
    await setTarget(db, admin, { ...base, custom: [{ name: "Brochures delivered", goal: 50, achieved: 50 }, { name: "Expo visits", goal: 3, achieved: 1 }] });

    const grid = await listTargets(db, admin, { period: "monthly", anchor: "2026-11-01", q: a.name.slice(-3) }, NOW);
    expect(grid.rows.map((r) => r.name)).toEqual([a.name]);
    expect(grid.rows[0].custom).toEqual([
      { name: "Brochures delivered", goal: 50, achieved: 50, met: true },
      { name: "Expo visits", goal: 3, achieved: 1, met: false },
    ]);
    expect(targetsCsv(grid)).toContain("Brochures delivered: 50/50; Expo visits: 1/3");
    expect((await targetsMetFor(db, [a.id], "2026-11-01", "2026-11-30")).get(a.id)).toEqual({ met: 1, set: 2 });
    const dash = (await dashboardData(db, a, f.projectId, {}, NOW)).data!;
    expect(dash.targets?.month).toEqual(expect.arrayContaining([{ label: "Expo visits", actual: 1, target: 3, met: false }]));

    // Leaving custom goals out keeps them; sending none with all zeros clears the target.
    await setTarget(db, admin, { ...base, calls: 10 });
    expect((await listTargets(db, admin, { period: "monthly", anchor: "2026-11-01" }, NOW)).rows.find((r) => r.userId === a.id)?.custom).toHaveLength(2);
    expect(await setTarget(db, admin, { ...base, custom: [] })).toMatchObject({ cleared: true });
  });
});
