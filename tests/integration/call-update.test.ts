import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { logCallUpdate } from "@/modules/leads/call-update";
import { followUps, leadActivities, leads, meetings } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const inDays = (d: number, hour = 10) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + d);
  t.setUTCHours(hour, 0, 0, 0);
  return t.toISOString();
};

/** "Update after call" (owner, 14 Nov 2026): one save for the call, stage, meeting and next follow-up. */
describe.skipIf(!hasTestDb)("Update after call (PostgreSQL integration)", () => {
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

  const newLead = async () => {
    const r = await createLead(db, f.actors.agent1, leadInput(f));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };

  it("records the call, books the meeting, completes the picked follow-up and sets the next one in one save", async () => {
    const leadId = await newLead();
    // A follow-up that was due by now: this call answers it.
    const [due] = await db.insert(followUps).values({ leadId, assigneeId: f.actors.agent1.id, dueAt: new Date(Date.now() - 3_600_000), createdById: f.actors.agent1.id }).returning();

    const out = await logCallUpdate(db, f.actors.agent1, leadId, {
      result: "talked",
      minutes: 4,
      note: "Will visit next week with family",
      stage: "contacted",
      meeting: { type: "site_visit", startsAt: inDays(7, 6) },
      completeFollowUpIds: [due.id],
      followUp: { dueAt: inDays(6), note: "Confirm the meeting" },
    });
    expect(out.done).toEqual(["call", "stage", "meeting", "followUpDone", "followUp"]);

    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead.stage).toBe("meeting_scheduled");
    expect(lead.latestComment).toBe("Call · Talked · 4 min\nWill visit next week with family");
    expect(await db.select().from(meetings).where(eq(meetings.leadId, leadId))).toHaveLength(1);
    const ups = await db.select().from(followUps).where(eq(followUps.leadId, leadId));
    expect(ups.map((u) => u.status).sort()).toEqual(["done", "pending"]);
    expect(ups.find((u) => u.status === "pending")?.note).toBe("Confirm the meeting");
  });

  it("completes only the follow-ups the agent picked, overdue or not, with or without a next one", async () => {
    const leadId = await newLead();
    const add = async (lead: string, ms: number) =>
      (await db.insert(followUps).values({ leadId: lead, assigneeId: f.actors.agent1.id, dueAt: new Date(Date.now() + ms), createdById: f.actors.agent1.id }).returning())[0];
    const [older, overdue, tomorrow] = [await add(leadId, -2 * 3_600_000), await add(leadId, -3_600_000), await add(leadId, 86_400_000)];
    const statuses = async () => (await db.select().from(followUps).where(eq(followUps.leadId, leadId)).orderBy(followUps.dueAt)).map((u) => u.status);
    const log = (completeFollowUpIds?: string[], extra = {}) => logCallUpdate(db, f.actors.agent1, leadId, { result: "talked", completeFollowUpIds, ...extra });

    // Nothing is assumed: overdue follow-ups stay pending, even with a next one scheduled.
    await log();
    await log([], { followUp: { dueAt: inDays(3) } });
    expect(await statuses()).toEqual(["pending", "pending", "pending", "pending"]);
    expect((await log([overdue.id])).done).toEqual(["call", "followUpDone"]);
    expect(await statuses()).toEqual(["pending", "done", "pending", "pending"]);
    await log([tomorrow.id, tomorrow.id]);
    expect(await statuses()).toEqual(["pending", "done", "done", "pending"]);
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead.nextFollowUpAt).toEqual(older.dueAt);

    // Already done, or another lead's: refused, and nothing of that save is kept.
    const foreign = await add(await newLead(), -3_600_000);
    for (const bad of [overdue.id, foreign.id]) {
      const err = await log([older.id, bad], { note: "must not be saved" }).catch((e: unknown) => e);
      expect((err as AppError).code).toBe("CONFLICT");
    }
    expect((await statuses())[0]).toBe("pending");
    expect((await db.select().from(followUps).where(eq(followUps.id, foreign.id)))[0].status).toBe("pending");
    expect(JSON.stringify(await db.select().from(leadActivities).where(eq(leadActivities.leadId, leadId)))).not.toContain("must not be saved");
  });

  it("a missed call only records the attempt and the retry", async () => {
    const leadId = await newLead();
    await logCallUpdate(db, f.actors.agent1, leadId, { result: "no_answer", stage: "contact_attempted", followUp: { dueAt: inDays(1) } });
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead.stage).toBe("contact_attempted");
    expect(await db.select().from(meetings).where(eq(meetings.leadId, leadId))).toHaveLength(0);
  });

  it("No call updates the stage and adds a plain note, without logging a call", async () => {
    const leadId = await newLead();
    const out = await logCallUpdate(db, f.actors.agent1, leadId, { result: "no_call", note: "Brother will decide", stage: "qualified_lead" });
    expect(out.done).toEqual(["note", "stage"]);
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead).toMatchObject({ stage: "qualified_lead", latestComment: "Brother will decide" });
  });

  it("a refused part saves nothing at all", async () => {
    const leadId = await newLead();
    const before = await db.select().from(leadActivities).where(eq(leadActivities.leadId, leadId));
    const err = await logCallUpdate(db, f.actors.agent1, leadId, { result: "talked", note: "x", followUp: { dueAt: inDays(-2) } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).fields?.["followUp.dueAt"]).toBe("Pick a time in the future");
    // A failure inside the save (another agent's lead) rolls back the note too.
    const theirs = await logCallUpdate(db, f.actors.agent2, leadId, { result: "talked", note: "sneaky" }).catch((e: unknown) => e);
    expect((theirs as AppError).code).toBe("NOT_FOUND");
    expect(await db.select().from(leadActivities).where(eq(leadActivities.leadId, leadId))).toHaveLength(before.length);
    expect(await db.select().from(followUps).where(and(eq(followUps.leadId, leadId), eq(followUps.status, "pending")))).toHaveLength(0);
  });
});
