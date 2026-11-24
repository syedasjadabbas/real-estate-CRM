import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead, markLost } from "@/modules/leads/commands";
import { listLeads } from "@/modules/leads/queries";
import type { Database } from "@/server/db";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

describe.skipIf(!hasTestDb)("A lead shows the customer's other projects (client, 24 Nov 2026; PostgreSQL)", () => {
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

  const add = async (projectId: string, phoneNumber: string) => {
    const r = await createLead(db, f.actors.superAdmin, leadInput(f, { projectId, phoneNumber, ownerId: f.actors.agent1.id }));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };
  const shown = async (projectId: string) => new Map((await listLeads(db, f.actors.agent1, projectId, {})).rows.map((r) => [r.id, r.otherProjects]));

  it("lists the other project by name on both leads, and nothing for a customer with one enquiry", async () => {
    const here = await add(f.projectId, "03005550101");
    const there = await add(f.otherProjectId, "0300 5550101");
    const single = await add(f.projectId, "03005550102");
    expect((await shown(f.projectId)).get(here)).toEqual(["Other Project"]);
    expect((await shown(f.otherProjectId)).get(there)).toEqual(["Test Project"]);
    expect((await shown(f.projectId)).get(single)).toEqual([]);
  });

  it("leaves out an enquiry that was lost", async () => {
    const here = await add(f.projectId, "03005550103");
    const there = await add(f.otherProjectId, "03005550103");
    await markLost(db, f.actors.superAdmin, there, { lostReasonId: f.lostReasonId });
    expect((await shown(f.projectId)).get(here)).toEqual([]);
  });
});
