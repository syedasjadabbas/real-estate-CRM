import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addNote, changeStage, createLead, scheduleFollowUp } from "@/modules/leads/commands";
import { logCallUpdate } from "@/modules/leads/call-update";
import { listLeads } from "@/modules/leads/queries";
import { completeMeeting, createMeeting } from "@/modules/meetings/commands";
import { leads, meetings } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

describe.skipIf(!hasTestDb)("Last contact is a real customer interaction (client, 23 Nov 2026; PostgreSQL)", () => {
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

  const lead = async () => {
    const r = await createLead(db, f.actors.superAdmin, leadInput(f, { ownerId: f.actors.agent1.id }));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };
  const contact = async (id: string) => (await db.select({ at: leads.lastContactAt }).from(leads).where(eq(leads.id, id)))[0].at;

  it("notes, stage moves, follow-ups, unanswered calls and planned meetings don't count; talking does", async () => {
    const id = await lead();
    const agent = f.actors.agent1;
    await addNote(db, agent, id, { body: "Looks promising" });
    await changeStage(db, agent, id, { stage: "contact_attempted" });
    await scheduleFollowUp(db, agent, id, { dueAt: new Date(Date.now() + 86_400_000).toISOString() });
    for (const result of ["no_answer", "busy", "switched_off", "wrong_number", "no_call"]) await logCallUpdate(db, agent, id, { result, note: "x" });
    await createMeeting(db, agent, { title: "Visit", type: "site_visit", startsAt: new Date(Date.now() + 3_600_000).toISOString(), leadId: id });
    expect(await contact(id)).toBeNull();

    const talkedAt = new Date();
    await logCallUpdate(db, agent, id, { result: "talked" }, talkedAt);
    expect(await contact(id)).toEqual(talkedAt);
    await logCallUpdate(db, agent, id, { result: "no_answer" });
    expect(await contact(id)).toEqual(talkedAt);
  });

  it("a completed meeting counts at its own time and never moves the date back", async () => {
    const id = await lead();
    const agent = f.actors.agent1;
    const { meetingId } = await createMeeting(db, agent, { title: "Visit", type: "site_visit", startsAt: new Date(Date.now() + 3_600_000).toISOString(), leadId: id });
    const held = new Date(Date.now() - 2 * 3_600_000);
    await db.update(meetings).set({ startsAt: held }).where(eq(meetings.id, meetingId));
    await completeMeeting(db, agent, meetingId, { moveLead: false });
    expect(await contact(id)).toEqual(held);

    const second = await createMeeting(db, agent, { title: "Older", type: "site_visit", startsAt: new Date(Date.now() + 3_600_000).toISOString(), leadId: id });
    await db.update(meetings).set({ startsAt: new Date(held.getTime() - 86_400_000) }).where(eq(meetings.id, second.meetingId));
    await completeMeeting(db, agent, second.meetingId, { moveLead: false });
    expect(await contact(id)).toEqual(held);
  });

  it("New leads, Meetings scheduled and Booking in process list the right leads", async () => {
    const [fresh, talked, planned, held, booking] = [await lead(), await lead(), await lead(), await lead(), await lead()];
    const agent = f.actors.agent1;
    await logCallUpdate(db, agent, talked, { result: "talked" });
    await createMeeting(db, agent, { title: "Visit", type: "site_visit", startsAt: new Date(Date.now() + 3_600_000).toISOString(), leadId: planned, moveLead: false });
    await db.update(leads).set({ stage: "meeting_done", lastContactAt: new Date() }).where(eq(leads.id, held));
    await db.update(leads).set({ stage: "booking_in_process" }).where(eq(leads.id, booking));
    const ids = async (view: string) => (await listLeads(db, agent, f.projectId, { view })).rows.map((r) => r.id).sort();
    expect(await ids("new")).toEqual([fresh, planned].sort());
    expect(await ids("meetings")).toEqual([planned]);
    expect(await ids("booking")).toEqual([booking]);
  });

  it("the list shows and sorts by it, with leads never contacted last", async () => {
    const [a, b, c] = [await lead(), await lead(), await lead()];
    await logCallUpdate(db, f.actors.agent1, a, { result: "talked" }, new Date(Date.now() - 60_000));
    await logCallUpdate(db, f.actors.agent1, c, { result: "talked" });
    const ids = async (dir: string) => (await listLeads(db, f.actors.agent1, f.projectId, { sort: "lastContact", dir })).rows.map((r) => r.id);
    expect(await ids("desc")).toEqual([c, a, b]);
    expect(await ids("asc")).toEqual([a, c, b]);
  });
});
