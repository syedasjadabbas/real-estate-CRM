import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getClientDetail } from "@/modules/clients/queries";
import { createLead } from "@/modules/leads/commands";
import { enquiriesFor, recordRepeatEnquiry } from "@/modules/leads/enquiries";
import { decideImportBatch, submitImport } from "@/modules/leads/imports";
import { getLeadDetail, listLeads } from "@/modules/leads/queries";
import { leads, leadSources, notifications } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
};

describe.skipIf(!hasTestDb)("Enquiry history and repeat enquiries (client, 24 Nov 2026; PostgreSQL)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let walkIn: string;
  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [s] = await db.insert(leadSources).values({ name: "Walk in test", sortOrder: 99 }).onConflictDoUpdate({ target: leadSources.name, set: { sortOrder: 99 } }).returning();
    walkIn = s.id;
  });

  const lead = async (phoneNumber: string, projectId = f.projectId, ownerId = f.actors.agent1.id) => {
    const r = await createLead(db, f.actors.superAdmin, leadInput(f, { phoneNumber, projectId, ownerId }));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };
  const told = async (userId: string) => (await db.select().from(notifications).where(eq(notifications.userId, userId))).filter((n) => n.type === "lead_regenerated");

  it("keeps the first enquiry, then each repeat with its channel, date, agent and note", async () => {
    const id = await lead("03006660001");
    const before = await enquiriesFor(db, [id]);
    expect(before).toMatchObject([{ isRepeat: false, channel: "Facebook", agentName: f.actors.agent1.name, projectName: "Test Project" }]);

    await recordRepeatEnquiry(db, f.actors.agent1, id, { channel: walkIn, note: "Came to the office" });
    await recordRepeatEnquiry(db, f.actors.agent1, id, { channel: "other", channelOther: "Expo stall" });
    const rows = (await getLeadDetail(db, f.actors.agent1, id)).lead.enquiries;
    expect(rows.map((r) => [r.isRepeat, r.channel, r.note])).toEqual([
      [true, "Expo stall", null],
      [true, "Walk in test", "Came to the office"],
      [false, "Facebook", null],
    ]);
    expect((await listLeads(db, f.actors.agent1, f.projectId, { view: "regenerated" })).rows.map((r) => r.id)).toEqual([id]);
    // The lead keeps its original source.
    expect((await db.select().from(leads).where(eq(leads.id, id)))[0].sourceId).toBe(f.sourceId);
  });

  it("needs a listed channel or a named Other, and a date between the lead's and now", async () => {
    const id = await lead("03006660002");
    const bad = async (input: Record<string, unknown>) => Object.keys((await errorOf(recordRepeatEnquiry(db, f.actors.agent1, id, input)))?.fields ?? {});
    expect(await bad({ channel: "" })).toContain("channel");
    expect(await bad({ channel: "other", channelOther: " " })).toContain("channelOther");
    expect(await bad({ channel: "00000000-0000-4000-8000-000000000000" })).toContain("channel");
    expect(await bad({ channel: walkIn, at: new Date(Date.now() + 3_600_000).toISOString() })).toContain("at");
    expect(await bad({ channel: walkIn, at: new Date(Date.now() - 86_400_000).toISOString() })).toContain("at");
    expect((await errorOf(recordRepeatEnquiry(db, f.actors.agent2, id, { channel: walkIn })))?.code).toBe("NOT_FOUND");
    expect(await enquiriesFor(db, [id])).toHaveLength(1);
  });

  it("Add lead records a repeat for the same project (another agent's too, without showing it); a new project is a new lead with the same agent", async () => {
    const id = await lead("03006660003");
    const r = await createLead(db, f.actors.agent2, leadInput(f, { phoneNumber: "03006660003", onDuplicate: "regenerate", channelOther: "Expo stall" }));
    expect(r).toMatchObject({ outcome: "regenerated", leadId: null });
    expect((await enquiriesFor(db, [id]))[0]).toMatchObject({ isRepeat: true, channel: "Expo stall", agentName: f.actors.agent1.name, recordedBy: f.actors.agent2.name });
    expect(await told(f.actors.agent1.id)).toHaveLength(1);

    const other = await createLead(db, f.actors.superAdmin, leadInput(f, { phoneNumber: "03006660003", projectId: f.otherProjectId }));
    if (other.outcome !== "created") throw new Error("other");
    const [row] = await db.select().from(leads).where(eq(leads.id, other.leadId));
    expect(row.ownerId).toBe(f.actors.agent1.id);
    expect(await enquiriesFor(db, [other.leadId])).toMatchObject([{ isRepeat: false }]);
  });

  it("a lost lead tells its agent to decide and stays lost; a booked lead is only recorded", async () => {
    const lost = await lead("03006660004");
    const booked = await lead("03006660005");
    await db.update(leads).set({ stage: "lost_lead" }).where(eq(leads.id, lost));
    await db.update(leads).set({ stage: "booked" }).where(eq(leads.id, booked));
    await recordRepeatEnquiry(db, f.actors.superAdmin, lost, { channel: walkIn });
    await recordRepeatEnquiry(db, f.actors.superAdmin, booked, { channel: walkIn });
    const notes = await told(f.actors.agent1.id);
    expect(notes.map((n) => n.body)).toEqual([expect.stringContaining("decide whether to reopen")]);
    expect((await db.select().from(leads).where(eq(leads.id, lost)))[0].stage).toBe("lost_lead");
    expect(await enquiriesFor(db, [booked])).toHaveLength(2);
  });

  it("the client page has the whole history; on another agent's lead only date, channel and project show", async () => {
    const mine = await lead("03006660006");
    const theirs = await lead("03006660006", f.otherProjectId, f.actors.agent1.id);
    await db.update(leads).set({ ownerId: f.actors.agent2.id }).where(eq(leads.id, theirs));
    await recordRepeatEnquiry(db, f.actors.agent2, theirs, { channel: walkIn, note: "Private note" });
    const [row] = await db.select().from(leads).where(eq(leads.id, mine));
    const all = (await getClientDetail(db, f.actors.superAdmin, row.clientId!)).enquiries;
    expect(all.map((e) => e.projectName).sort()).toEqual(["Other Project", "Other Project", "Test Project"]);
    const seen = (await getClientDetail(db, f.actors.agent1, row.clientId!)).enquiries;
    const hidden = seen.filter((e) => e.projectName === "Other Project");
    expect(hidden).toHaveLength(2);
    expect(hidden[0]).toMatchObject({ channel: "Walk in test", leadId: null, leadCode: null, agentName: null, recordedBy: null, note: null });
  });

  it("an import records known customers as repeats on approval, once a day per channel", async () => {
    const id = await lead("03006660007");
    const run = async () => {
      const b = await submitImport(db, f.actors.superAdmin, { projectId: f.projectId, fileName: "a.csv", csv: "first_name,phone,source,note\nAli,03006660007,Facebook,Again\nNew,03006660008,Facebook," });
      return decideImportBatch(db, f.actors.superAdmin, b.batchId, { approve: true });
    };
    // Recorded today already as the lead's own first enquiry on Facebook: move that to yesterday.
    await db.execute("update lead_enquiries set created_at = now() - interval '2 days'");
    expect(await run()).toEqual({ status: "approved", created: 1, skipped: 0, repeats: 1 });
    expect(await run()).toEqual({ status: "approved", created: 0, skipped: 0, repeats: 0 });
    expect((await enquiriesFor(db, [id])).map((e) => [e.isRepeat, e.note])).toEqual([[true, "Again"], [false, null]]);
  });
});
