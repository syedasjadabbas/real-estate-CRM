import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { performanceCsv, performanceReport } from "@/modules/performance/service";
import { leads } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const NOW = new Date("2026-10-29T05:00:00Z");
const RANGE = { from: "2026-10-01", to: "2026-10-29" };
const INSIDE = new Date("2026-10-10T07:00:00Z");
const OUTSIDE = new Date("2026-08-10T07:00:00Z");
const HOUR = 3_600_000;

describe.skipIf(!hasTestDb)("FR-028: first touch in the Performance report (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
  });

  /** A lead owned by `owner`, created at `at`, first touched `touchHours` later (or never). */
  const lead = async (owner: Actor, at: Date, touchHours: number | null) => {
    const r = await createLead(db, owner, leadInput(f));
    if (r.outcome !== "created") throw new Error("setup");
    await db
      .update(leads)
      .set({ createdAt: at, firstTouchAt: touchHours === null ? null : new Date(at.getTime() + touchHours * HOUR) })
      .where(eq(leads.id, r.leadId));
  };
  const report = (query: Record<string, string> = {}, actor = f.actors.superAdmin) => performanceReport(db, actor, { ...RANGE, ...query }, NOW);
  const avgOf = async (who: Actor) => (await report()).allRows.find((r) => r.userId === who.id)?.avgFirstTouchMs;

  it("averages the time to first touch across the agent's leads in the range", async () => {
    await lead(f.actors.agent1, INSIDE, 1);
    await lead(f.actors.agent1, INSIDE, 3);
    expect(await avgOf(f.actors.agent1)).toBe(2 * HOUR);
  });

  it("leaves out untouched leads, rather than counting them as instant", async () => {
    await lead(f.actors.agent1, INSIDE, 4);
    await lead(f.actors.agent1, INSIDE, null);
    expect(await avgOf(f.actors.agent1)).toBe(4 * HOUR);
    expect((await report()).allRows.find((r) => r.userId === f.actors.agent1.id)?.leads).toBe(2);
  });

  it("leaves out leads outside the range", async () => {
    await lead(f.actors.agent1, INSIDE, 2);
    await lead(f.actors.agent1, OUTSIDE, 100);
    expect(await avgOf(f.actors.agent1)).toBe(2 * HOUR);
  });

  it("is blank, not zero, for an agent with no touched leads", async () => {
    await lead(f.actors.agent1, INSIDE, null);
    expect(await avgOf(f.actors.agent1)).toBeNull();
    expect(await avgOf(f.actors.agent2)).toBeNull();
  });

  it("counts each agent separately", async () => {
    await lead(f.actors.agent1, INSIDE, 1);
    await lead(f.actors.agent2, INSIDE, 5);
    expect(await avgOf(f.actors.agent1)).toBe(HOUR);
    expect(await avgOf(f.actors.agent2)).toBe(5 * HOUR);
  });

  it("sorts both ways, with blanks last", async () => {
    await lead(f.actors.agent1, INSIDE, 1);
    await lead(f.actors.agent2, INSIDE, 5);
    const order = async (dir: "asc" | "desc") => (await report({ sort: "avgFirstTouchMs", dir })).allRows.map((r) => r.avgFirstTouchMs);
    const asc = await order("asc");
    const desc = await order("desc");
    expect(asc.slice(0, 2)).toEqual([HOUR, 5 * HOUR]);
    expect(desc.slice(0, 2)).toEqual([5 * HOUR, HOUR]);
    expect(asc.slice(2).every((v) => v === null)).toBe(true);
    expect(desc.slice(2).every((v) => v === null)).toBe(true);
  });

  it("the CSV gives whole minutes in its own column, and blank when there is none", async () => {
    await lead(f.actors.agent1, INSIDE, 1.5);
    const r = await report();
    const [header, ...lines] = performanceCsv(r).trim().split("\n");
    // Targets met and goals set follow it (14 Nov 2026).
    expect(header.endsWith(",CRM sign-outs,Avg first touch (min),Targets met,Target goals set")).toBe(true);
    const index = r.allRows.findIndex((x) => x.userId === f.actors.agent1.id);
    expect(lines[index].split(",").at(-3)).toBe("90");
    const blank = r.allRows.findIndex((x) => x.userId === f.actors.agent2.id);
    expect(lines[blank].split(",").at(-3)).toBe("");
  });

  it("keeps report scope: an agent sees only their own row", async () => {
    await lead(f.actors.agent1, INSIDE, 1);
    await lead(f.actors.agent2, INSIDE, 5);
    const own = await report({}, f.actors.agent1);
    expect(own.allRows.map((r) => r.avgFirstTouchMs)).toEqual([HOUR]);
  });
});
