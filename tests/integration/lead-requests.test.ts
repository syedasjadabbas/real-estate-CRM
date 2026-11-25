import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookedFormOptions, requestBooked } from "@/modules/bookings/booked-request";
import { dashboardData } from "@/modules/dashboard/queries";
import { updateClient } from "@/modules/clients/commands";
import { createUnit } from "@/modules/inventory/commands";
import { logCallUpdate } from "@/modules/leads/call-update";
import { addNote, assignLead, changeStage, createLead, markOpened, updateLead } from "@/modules/leads/commands";
import { decideLeadRequest } from "@/modules/leads/decide-request";
import { leadRequestsFor, pendingLeadRequests } from "@/modules/leads/requests";
import { getLeadDetail, listLeads, reviewsFeed, wonSummary } from "@/modules/leads/queries";
import { completeMeeting, createMeeting } from "@/modules/meetings/commands";
import { addMeetingReview, meetingReviewsFor } from "@/modules/meetings/reviews";
import { pendingVerificationCount } from "@/modules/leads/verification";
import { bookings, clients, leads, lostReasons, notifications, units } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { postDownPayment } from "../support/down-payment";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

describe.skipIf(!hasTestDb)("Client's notes of 25 Nov 2026 (PostgreSQL)", () => {
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
  const newLead = async (overrides = {}) => {
    const r = await createLead(db, f.actors.superAdmin, leadInput(f, { name: "Old Name", ownerId: f.actors.agent1.id, ...overrides }));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };
  const errorOf = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as AppError);
  const row = async (id: string) => (await db.select().from(leads).where(eq(leads.id, id)))[0];

  it("an agent's new name waits for an Admin, who approves or rejects it", async () => {
    const id = await newLead();
    const saved = await updateLead(db, f.actors.agent1, id, { firstName: "Mr New", lastName: "Name", priority: "high" });
    expect(saved).toMatchObject({ changed: ["priority"], nameRequested: true });
    expect((await row(id)).name).toBe("Old Name");
    expect((await errorOf(updateLead(db, f.actors.agent1, id, { name: "Another" })))?.code).toBe("CONFLICT");
    expect((await errorOf(updateLead(db, f.actors.superAdmin, id, { name: "Name 2" })))?.fields?.firstName).toMatch(/numbers/);
    const [request] = await leadRequestsFor(db, id);
    expect(await pendingVerificationCount(db, f.actors.superAdmin, f.projectId)).toBe(1);
    expect((await db.select().from(notifications).where(eq(notifications.type, "lead_request"))).map((n) => n.userId)).toContain(f.actors.superAdmin.id);
    expect((await errorOf(decideLeadRequest(db, f.actors.agent1, request.id, { approve: true })))?.code).toBe("FORBIDDEN");
    expect((await errorOf(decideLeadRequest(db, f.actors.superAdmin, request.id, { approve: false })))?.fields?.comment).toBeTruthy();
    await decideLeadRequest(db, f.actors.superAdmin, request.id, { approve: true });
    const lead = await row(id);
    expect(lead).toMatchObject({ name: "Mr New Name", firstName: "Mr New", lastName: "Name" });
    expect((await db.select().from(clients).where(eq(clients.id, lead.clientId!)))[0].name).toBe("Mr New Name");
    expect((await errorOf(decideLeadRequest(db, f.actors.superAdmin, request.id, { approve: true })))?.code).toBe("BUSINESS_RULE");
    expect((await errorOf(updateClient(db, f.actors.agent1, lead.clientId!, { name: "Sneaky Name" })))?.code).toBe("FORBIDDEN");
    expect(await pendingLeadRequests(db, f.projectId)).toEqual([]);
  });

  it("a wrong number goes to an Admin: corrected, right after all, or lost", async () => {
    const [corrected, right, lost] = [await newLead(), await newLead(), await newLead()];
    await db.insert(lostReasons).values({ name: "Invalid number" }).onConflictDoNothing();
    for (const id of [corrected, right, lost]) {
      expect((await logCallUpdate(db, f.actors.agent1, id, { result: "wrong_number", note: "Someone else answered" })).done).toContain("wrongNumber");
      expect((await row(id)).wrongNumberAt).not.toBeNull();
      expect((await errorOf(addNote(db, f.actors.agent1, id, { body: "x" })))?.code).toBe("BUSINESS_RULE");
      expect((await getLeadDetail(db, f.actors.agent1, id)).permissions.edit).toBe(false);
    }
    const ask = async (id: string) => (await leadRequestsFor(db, id))[0].id;
    expect((await errorOf(decideLeadRequest(db, f.actors.superAdmin, await ask(corrected), { approve: true, phoneCountryCode: "+92", phoneNumber: "0300" })))?.fields?.phoneNumber).toBeTruthy();
    expect((await row(corrected)).wrongNumberAt).not.toBeNull();
    expect(await decideLeadRequest(db, f.actors.superAdmin, await ask(corrected), { approve: true, phoneCountryCode: "+92", phoneNumber: "0300 5550001" })).toEqual({ outcome: "corrected" });
    expect(await row(corrected)).toMatchObject({ phoneE164: "+923005550001", wrongNumberAt: null, ownerId: f.actors.agent1.id });
    await decideLeadRequest(db, f.actors.superAdmin, await ask(right), { approve: false, comment: "I called, it is right" });
    await addNote(db, f.actors.agent1, right, { body: "back to work" });
    expect(await decideLeadRequest(db, f.actors.superAdmin, await ask(lost), { approve: true })).toEqual({ outcome: "lost" });
    expect(await row(lost)).toMatchObject({ stage: "lost_lead", wrongNumberAt: null });
    // An Admin logging it doesn't ask themselves.
    const own = await newLead();
    expect((await logCallUpdate(db, f.actors.superAdmin, own, { result: "wrong_number" })).done).not.toContain("wrongNumber");
  });

  it("a talked call needs the minutes and what happened", async () => {
    const id = await newLead();
    const e = await errorOf(logCallUpdate(db, f.actors.agent1, id, { result: "talked" }));
    expect(Object.keys(e?.fields ?? {}).sort()).toEqual(["minutes", "note"]);
    await logCallUpdate(db, f.actors.agent1, id, { result: "no_answer" });
    await logCallUpdate(db, f.actors.agent1, id, { result: "talked", minutes: 3, note: "Interested" });
  });

  it("Successfully Booked holds the unit, waits for an Admin, and needs the down payment posted", async () => {
    const id = await newLead();
    await changeStage(db, f.actors.agent1, id, { stage: "qualified_lead" });
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "B-1", areaSqft: "500", basePrice: "10000000" });
    const input = { unitId, tokenAmount: "500000", note: "Paid in cash" };
    const files = [{ bytes: PNG, name: "receipt.png" }];
    expect((await errorOf(requestBooked(db, f.actors.agent1, id, input, [])))?.fields?.files).toBeTruthy();
    expect((await errorOf(requestBooked(db, f.actors.agent2, id, input, files)))?.code).toBe("NOT_FOUND");
    const { requestId, bookingId } = await requestBooked(db, f.actors.agent1, id, input, files);
    expect((await row(id)).stage).toBe("booking_in_process");
    expect((await db.select().from(units).where(eq(units.id, unitId)))[0].status).toBe("reserved");
    expect((await bookedFormOptions(db, f.actors.agent1, id)).waiting).toBe(true);
    expect((await errorOf(requestBooked(db, f.actors.agent1, id, input, files)))?.code).toBe("CONFLICT");
    // Not final before the money is in Finance.
    expect((await errorOf(decideLeadRequest(db, f.actors.superAdmin, requestId, { approve: true })))?.message).toMatch(/down payment/);
    expect((await row(id)).stage).toBe("booking_in_process");
    await postDownPayment(db, f.actors.superAdmin, bookingId);
    await decideLeadRequest(db, f.actors.superAdmin, requestId, { approve: true });
    expect((await row(id)).stage).toBe("booked");
    expect((await db.select().from(bookings).where(eq(bookings.id, bookingId)))[0].stage).toBe("confirmed");
    expect((await db.select().from(units).where(eq(units.id, unitId)))[0].status).toBe("booked");
    expect((await wonSummary(db, f.actors.superAdmin, f.projectId)).byAgent).toMatchObject([{ id: f.actors.agent1.id, n: 1 }]);

    // Rejected: the booking the request made is cancelled and the lead goes back.
    const other = await newLead();
    const second = (await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "B-2", areaSqft: "500", basePrice: "10000000" })).unitId;
    const r = await requestBooked(db, f.actors.agent1, other, { unitId: second, tokenAmount: "500000" }, files);
    await decideLeadRequest(db, f.actors.superAdmin, r.requestId, { approve: false, comment: "Screenshot is not ours" });
    expect((await row(other)).stage).toBe("new_lead");
    expect((await db.select().from(units).where(eq(units.id, second)))[0].status).toBe("available");
  });

  it("a New lead becomes Open when its own agent opens it, and the groups add up", async () => {
    const [fresh, opened, contacted, qualified, future] = [await newLead(), await newLead(), await newLead(), await newLead(), await newLead()];
    await markOpened(db, f.actors.superAdmin, opened); // an Admin's look doesn't count
    expect((await row(opened)).openedAt).toBeNull();
    await markOpened(db, f.actors.agent1, opened);
    await changeStage(db, f.actors.agent1, contacted, { stage: "contacted" });
    await changeStage(db, f.actors.agent1, qualified, { stage: "qualified_lead" });
    await changeStage(db, f.actors.agent1, future, { stage: "future_opportunity" });
    const { data } = await dashboardData(db, f.actors.superAdmin, f.projectId, { range: "30d" }, new Date());
    const p = data!.projectLeads.find((x) => x.id === f.projectId)!;
    expect([p.total, p.fresh, p.open, p.inProgress, p.future, p.won, p.lost]).toEqual([5, 1, 2, 1, 1, 0, 0]);
    expect(p.steps).toMatchObject({ opened: 1, contacted: 1, qualified: 1 });
    expect(data!.kpis).toMatchObject({ openPipeline: 2, openPipelinePct: 40, qualified: 1, qualifiedRate: 20 });
    const ids = async (opened: string) => (await listLeads(db, f.actors.superAdmin, f.projectId, { opened })).rows.map((r) => r.id).sort();
    expect(await ids("0")).toEqual([fresh]);
    expect(await ids("1")).toEqual([opened, contacted].sort());
    await assignLead(db, f.actors.superAdmin, opened, { ownerId: f.actors.agent2.id });
    expect((await row(opened)).openedAt).toBeNull();
  });

  it("a held meeting is reviewed by its agent and an Admin", async () => {
    const id = await newLead();
    const { meetingId } = await createMeeting(db, f.actors.agent1, { title: "Visit", type: "site_visit", startsAt: new Date(Date.now() + 3_600_000).toISOString(), leadId: id, location: "Block A" });
    expect((await listLeads(db, f.actors.agent1, f.projectId, { view: "meetings" })).rows[0].openMeetings[0]).toMatchObject({ type: "site_visit", location: "Block A" });
    expect((await errorOf(addMeetingReview(db, f.actors.agent1, meetingId, { rating: 4, body: "Good" })))?.code).toBe("BUSINESS_RULE");
    await completeMeeting(db, f.actors.agent1, meetingId, {});
    expect(Object.keys((await errorOf(addMeetingReview(db, f.actors.agent1, meetingId, { rating: 0, body: "" })))?.fields ?? {}).sort()).toEqual(["body", "rating"]);
    await addMeetingReview(db, f.actors.agent1, meetingId, { rating: 4, body: "Liked the view" });
    await addMeetingReview(db, f.actors.superAdmin, meetingId, { rating: 5, body: "Well handled" });
    expect((await errorOf(addMeetingReview(db, f.actors.agent2, meetingId, { rating: 1, body: "Not mine" })))?.code).toBe("NOT_FOUND");
    expect((await meetingReviewsFor(db, f.actors.agent1, meetingId)).map((r) => r.rating)).toEqual([5, 4]);
    expect((await reviewsFeed(db, f.actors.superAdmin, f.projectId, { q: "x", rating: "5", kind: "call" })).total).toBe(0);
  });
});
