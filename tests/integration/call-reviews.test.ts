import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addReview, createLead } from "@/modules/leads/commands";
import { getLeadDetail } from "@/modules/leads/queries";
import { performanceReport } from "@/modules/performance/service";
import { files, leadReviews, notifications } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("expected a failure");
};

/** Call reviews (owner, 16 Nov 2026): a 1–5 score, the recording reviewed, the owner notified, Performance's average. */
describe.skipIf(!hasTestDb)("Call reviews (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let leadId: string;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const r = await createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: "03015550101" }));
    if (r.outcome !== "created") throw new Error("setup");
    leadId = r.leadId;
  });

  const recording = async (lead = leadId) => {
    const [row] = await db
      .insert(files)
      .values({ leadId: lead, kind: "call_recording", storageKey: `test/${crypto.randomUUID()}.mp3`, originalName: "call.mp3", mime: "audio/mpeg", sizeBytes: 10, sha256: "0".repeat(64), uploadedById: f.actors.agent1.id })
      .returning({ id: files.id });
    return row.id;
  };

  it("an Admin scores a call, names the recording, and the agent is notified", async () => {
    const rec = await recording();
    await addReview(db, f.actors.superAdmin, leadId, { body: "Good opening; confirm the budget next time.", rating: 4, recordingId: rec });
    const [review] = await db.select().from(leadReviews).where(eq(leadReviews.leadId, leadId));
    expect(review).toMatchObject({ rating: 4, recordingId: rec, agentId: f.actors.agent1.id });
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, f.actors.agent1.id), eq(notifications.type, "lead_reviewed")));
    expect(note.title).toContain("4/5");
    const detail = await getLeadDetail(db, f.actors.agent1, leadId);
    expect(detail.reviews[0]).toMatchObject({ rating: 4, recordingName: "call.mp3" });
    expect(detail.permissions.rateCalls).toBe(false);
  });

  it("agents can write notes but not score calls, and aren't notified about their own notes", async () => {
    expect((await failure(addReview(db, f.actors.agent1, leadId, { body: "Called, busy", rating: 5 }))).code).toBe("VALIDATION_FAILED");
    await addReview(db, f.actors.agent1, leadId, { body: "Called, busy" });
    expect(await db.select().from(notifications).where(eq(notifications.type, "lead_reviewed"))).toHaveLength(0);
  });

  it("refuses a score outside 1–5 and a recording from another lead", async () => {
    expect((await failure(addReview(db, f.actors.superAdmin, leadId, { body: "x", rating: 6 }))).code).toBe("VALIDATION_FAILED");
    const other = await createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: "03015550102" }));
    if (other.outcome !== "created") throw new Error("setup");
    const elsewhere = await recording(other.leadId);
    expect((await failure(addReview(db, f.actors.superAdmin, leadId, { body: "x", rating: 3, recordingId: elsewhere }))).code).toBe("VALIDATION_FAILED");
  });

  it("Performance shows each agent's average call review score and count", async () => {
    await addReview(db, f.actors.superAdmin, leadId, { body: "Good", rating: 4 });
    await addReview(db, f.actors.manager, leadId, { body: "Rushed", rating: 3 });
    await addReview(db, f.actors.superAdmin, leadId, { body: "Note only" });
    const report = await performanceReport(db, f.actors.superAdmin, {});
    const row = report.allRows.find((r) => r.userId === f.actors.agent1.id)!;
    expect(row).toMatchObject({ reviewAvg: 3.5, reviewCount: 2 });
    expect(report.allRows.find((r) => r.userId === f.actors.agent2.id)?.reviewAvg).toBeNull();
  });
});
