import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exportReport } from "@/modules/finance/reports";
import { createLead, updateLead } from "@/modules/leads/commands";
import { budgetRanges, leads } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const FORGED = "00000000-0000-4000-8000-000000000000";

async function failure(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe.skipIf(!hasTestDb)("Forged list ids and unknown reports (PostgreSQL integration)", () => {
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

  const newLead = async (overrides: Record<string, unknown> = {}) => {
    const r = await createLead(db, f.actors.agent1, leadInput(f, overrides));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };
  const budget = async () => (await db.insert(budgetRanges).values({ name: "Under PKR 10 million" }).returning())[0].id;

  it("creating a lead with a forged source or budget is a field error", async () => {
    const source = await failure(createLead(db, f.actors.agent1, leadInput(f, { sourceId: FORGED })));
    expect(source.code).toBe("VALIDATION_FAILED");
    expect(source.fields?.sourceId).toBeTruthy();
    expect((await failure(createLead(db, f.actors.agent1, leadInput(f, { budgetRangeId: FORGED })))).fields?.budgetRangeId).toBeTruthy();
    expect(await db.select().from(leads)).toEqual([]);
  });

  it("editing a lead with a forged source or budget is a field error, and changes nothing", async () => {
    const id = await newLead();
    expect((await failure(updateLead(db, f.actors.agent1, id, { sourceId: FORGED }))).fields?.sourceId).toBeTruthy();
    expect((await failure(updateLead(db, f.actors.agent1, id, { budgetRangeId: FORGED }))).fields?.budgetRangeId).toBeTruthy();
    expect((await db.select().from(leads).where(eq(leads.id, id)))[0]).toMatchObject({ sourceId: f.sourceId, budgetRangeId: null });
  });

  it("real values still work, and a budget can still be cleared", async () => {
    const budgetRangeId = await budget();
    const id = await newLead({ budgetRangeId });
    expect((await db.select().from(leads).where(eq(leads.id, id)))[0].budgetRangeId).toBe(budgetRangeId);
    await updateLead(db, f.actors.agent1, id, { budgetRangeId: "" });
    expect((await db.select().from(leads).where(eq(leads.id, id)))[0].budgetRangeId).toBeNull();
  });

  it("an unknown report name is refused rather than exporting Collections", async () => {
    const error = await failure(exportReport(db, f.actors.superAdmin, { report: "nonsense" }));
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.fields?.report).toBeTruthy();
  });

  it("a known report still exports, and no name still gives the default", async () => {
    const named = await exportReport(db, f.actors.superAdmin, { report: "collections" });
    const unnamed = await exportReport(db, f.actors.superAdmin, {});
    expect(unnamed.body).toBe(named.body);
  });
});
