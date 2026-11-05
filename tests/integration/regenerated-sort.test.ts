import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { listLeads } from "@/modules/leads/queries";
import { leads } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const HOUR = 3_600_000;

describe.skipIf(!hasTestDb)("FR-005: sorting the Regenerated view (PostgreSQL integration)", () => {
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
    const now = Date.now();
    const make = async (name: string, regeneratedHoursAgo: number, activityHoursAgo: number) => {
      const r = await createLead(db, f.actors.agent1, leadInput(f, { name }));
      if (r.outcome !== "created") throw new Error("setup");
      await db
        .update(leads)
        .set({ isRegenerated: true, regeneratedAt: new Date(now - regeneratedHoursAgo * HOUR), lastActivityAt: new Date(now - activityHoursAgo * HOUR) })
        .where(eq(leads.id, r.leadId));
    };
    await make("Bravo", 5, 1); // attended: activity after the re-inquiry
    await make("Alpha", 1, 0.5); // attended, and the newest re-inquiry
    await make("Charlie", 3, 4); // unattended
    await make("Delta", 6, 7); // unattended, older
  });

  const names = async (query: Record<string, string> = {}, actor = f.actors.superAdmin) =>
    (await listLeads(db, actor, f.projectId, { view: "regenerated", ...query })).rows.map((r) => r.name);

  it("with no sort chosen, unattended re-inquiries come first, newest first", async () => {
    expect(await names()).toEqual(["Charlie", "Delta", "Alpha", "Bravo"]);
  });

  it("a chosen sort replaces that order, in both directions", async () => {
    expect(await names({ sort: "name", dir: "asc" })).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    expect(await names({ sort: "name", dir: "desc" })).toEqual(["Delta", "Charlie", "Bravo", "Alpha"]);
  });

  it("choosing the Created column sorts by it, even though it is the other lists' default", async () => {
    expect(await names({ sort: "createdAt", dir: "asc" })).toEqual(["Bravo", "Alpha", "Charlie", "Delta"]);
  });

  it("an unknown sort keeps the view's own order", async () => {
    expect(await names({ sort: "password_hash", dir: "asc" })).toEqual(["Charlie", "Delta", "Alpha", "Bravo"]);
  });

  it("a direction alone doesn't change the view's own order", async () => {
    expect(await names({ dir: "asc" })).toEqual(["Charlie", "Delta", "Alpha", "Bravo"]);
  });

  it("sorting keeps the view, filters and record scope", async () => {
    await createLead(db, f.actors.agent1, leadInput(f, { name: "Not Regenerated" }));
    expect(await names({ sort: "name", dir: "asc" })).toHaveLength(4);
    expect(await names({ sort: "name", dir: "asc", q: "Charlie" })).toEqual(["Charlie"]);
    expect(await names({ sort: "name", dir: "asc" }, f.actors.agent2)).toEqual([]);
  });

  it("other lists still default to newest created", async () => {
    const { rows } = await listLeads(db, f.actors.superAdmin, f.projectId, {});
    expect(rows.map((r) => r.name)).toEqual(["Delta", "Charlie", "Alpha", "Bravo"]);
  });
});
