import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { employeeProfileCsv } from "@/modules/people/export";
import { addEmployeeNote } from "@/modules/people/notes";
import { employeeProfile } from "@/modules/people/profile";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

/** HR opens an agent's work profile read-only, without lead detail or coaching notes (owner, 18 Nov 2026). */
describe.skipIf(!hasTestDb)("HR: read-only work profile (PostgreSQL integration)", () => {
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
    const r = await createLead(db, f.actors.agent1, leadInput(f, { name: "Secret Customer", phoneNumber: "0300-5551234" }));
    if (r.outcome !== "created") throw new Error("setup");
    await addEmployeeNote(db, f.actors.superAdmin, f.actors.agent1.id, { body: "Private coaching" });
  });

  it("shows HR the figures but no lead names, activity or coaching notes", async () => {
    const p = await employeeProfile(db, f.actors.hr, f.actors.agent1.id);
    expect(p.leadDetail).toBe(false);
    expect(p.pipeline.find((s) => s.stage === "new_lead")?.count).toBe(1);
    expect(p).toMatchObject({ recordings: [], activity: [], overdueList: [], notes: [] });
    const csv = await employeeProfileCsv(db, f.actors.hr, f.actors.agent1.id, {});
    expect(csv).not.toContain("Secret Customer");
    expect(csv).not.toContain("Private coaching");
  });

  it("Admins still see everything, and HR can't write coaching notes", async () => {
    const p = await employeeProfile(db, f.actors.superAdmin, f.actors.agent1.id);
    expect(p.leadDetail).toBe(true);
    expect(p.activity.length).toBeGreaterThan(0);
    expect(p.notes).toHaveLength(1);
    await expect(addEmployeeNote(db, f.actors.hr, f.actors.agent1.id, { body: "x" })).rejects.toBeInstanceOf(AppError);
    await expect(employeeProfile(db, f.actors.agent2, f.actors.agent1.id)).rejects.toBeInstanceOf(AppError);
  });
});
