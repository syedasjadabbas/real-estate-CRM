import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, cancelBooking, createBooking, updateBookingDetails } from "@/modules/bookings/commands";
import { bookingFormOptions, getBookingDetail, listBookings } from "@/modules/bookings/queries";
import { convertLeadToClient, createClient } from "@/modules/clients/commands";
import { createUnit, setUnitStatus } from "@/modules/inventory/commands";
import { changeStage, createLead, decideLostRequest, markLost } from "@/modules/leads/commands";
import { pendingLostRequests } from "@/modules/leads/queries";
import { completeMeeting, createMeeting } from "@/modules/meetings/commands";
import { hashPassword } from "@/server/auth/password";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, bookingStageHistory, bookings, clients, leadActivities, leads, units, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
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
const errorCode = async (p: Promise<unknown>) => (await errorOf(p))?.code ?? "ok";
const TODAY = "2026-10-29";
const PATH = ["down_payment", "agreement_pending"] as const;

describe.skipIf(!hasTestDb)("Bookings module (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let accountant: Actor;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [u] = await db
      .insert(users)
      .values({ name: "Accountant", email: "acc@test.local", role: "accountant", passwordHash: await hashPassword("x-y-z-w-v") })
      .returning();
    accountant = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  });

  const unit = async (overrides: Record<string, unknown> = {}) =>
    (await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: `U-${Math.random().toString(36).slice(2, 7)}`, areaSqft: "500", basePrice: "10000000", ...overrides })).unitId;
  const leadOf = async (owner: Actor, overrides: Record<string, unknown> = {}) => {
    const r = await createLead(db, owner, leadInput(f, overrides));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };
  const book = (actor: Actor, leadId: string, unitId: string, overrides: Record<string, unknown> = {}) =>
    createBooking(db, actor, { projectId: f.projectId, leadId, unitId, ratePerSqft: "25,000", tokenAmount: "500000", reservedUntil: "2099-01-31", ...overrides });
  const statusOf = async (unitId: string) => (await db.select().from(units).where(eq(units.id, unitId)))[0].status;
  const leadStage = async (leadId: string) => (await db.select().from(leads).where(eq(leads.id, leadId)))[0].stage;
  const advanceTo = async (actor: Actor, bookingId: string, stages: readonly string[]) => {
    for (const s of stages.filter((x) => !["token_pending", "token_received", "provisional_receipt", "sales_order", "booking_form"].includes(x))) await advanceBooking(db, actor, bookingId, { toStage: s });
  };

  describe("create and reservation", () => {
    it("books an Available unit: unit Reserved, lead Booking in Process, total = area × rate, history and audit", async () => {
      const unitId = await unit();
      const leadId = await leadOf(f.actors.agent1);
      const { bookingId } = await book(f.actors.agent1, leadId, unitId, { paymentInstructions: "Bank transfer to escrow" });

      const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(b).toMatchObject({ stage: "token_pending", areaSqft: 500, ratePerSqft: 25_000, totalSale: 12_500_000, tokenAmount: 500_000, agentId: f.actors.agent1.id });
      // The lead's client (every lead has one since 13 Nov 2026) holds the booking at once.
      expect(b.clientId).toBe((await db.select({ clientId: leads.clientId }).from(leads).where(eq(leads.id, b.leadId)))[0].clientId);
      expect(await statusOf(unitId)).toBe("reserved");
      expect(await leadStage(leadId)).toBe("booking_in_process");
      const history = await db.select().from(bookingStageHistory).where(eq(bookingStageHistory.bookingId, bookingId));
      expect(history.map((h) => [h.fromStage, h.toStage])).toEqual([[null, "token_pending"]]);
      const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, bookingId));
      expect(audit.map((a) => a.action)).toEqual(["booking.create"]);
      const unitAudit = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, unitId), eq(auditLogs.action, "unit.status")));
      expect(unitAudit[0].after).toMatchObject({ status: "reserved", source: "booking" });
    });

    it("lets exactly one of two concurrent bookings claim the same unit", async () => {
      const unitId = await unit();
      const leadA = await leadOf(f.actors.agent1);
      const leadB = await leadOf(f.actors.agent2);
      const results = await Promise.allSettled([book(f.actors.agent1, leadA, unitId), book(f.actors.agent2, leadB, unitId)]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect((loser.reason as AppError).code).toBe("CONFLICT");
      expect(await db.select().from(bookings)).toHaveLength(1);
      expect(await statusOf(unitId)).toBe("reserved");
      // The losing transaction rolled back completely: its lead was not moved.
      const stages = [await leadStage(leadA), await leadStage(leadB)].sort();
      expect(stages).toEqual(["booking_in_process", "new_lead"]);
    });

    it("rejects invalid input and ineligible leads or units without changing anything", async () => {
      const unitId = await unit();
      const leadId = await leadOf(f.actors.agent1);
      const bad = await errorOf(book(f.actors.agent1, leadId, unitId, { ratePerSqft: "0", tokenAmount: "" }));
      expect(Object.keys(bad?.fields ?? {})).toEqual(expect.arrayContaining(["ratePerSqft", "tokenAmount"]));
      expect((await errorOf(book(f.actors.agent1, leadId, unitId, { tokenAmount: "99999999" })))?.fields).toHaveProperty("tokenAmount");
      expect((await errorOf(book(f.actors.agent1, leadId, unitId, { reservedUntil: "2020-01-01" })))?.fields).toHaveProperty("reservedUntil");

      const otherLead = await leadOf(f.actors.agent1, { projectId: f.otherProjectId });
      expect((await errorOf(book(f.actors.agent1, otherLead, unitId)))?.fields).toHaveProperty("leadId");
      const otherUnit = (await createUnit(db, f.actors.superAdmin, { projectId: f.otherProjectId, unitNo: "X1", areaSqft: "10", basePrice: "1" })).unitId;
      expect((await errorOf(book(f.actors.agent1, leadId, otherUnit)))?.fields).toHaveProperty("unitId");

      const sold = await unit();
      await setUnitStatus(db, f.actors.superAdmin, sold, { status: "sold", reason: "Sold earlier" });
      expect(await errorCode(book(f.actors.agent1, leadId, sold))).toBe("CONFLICT");
      expect(await errorCode(book(f.actors.agent1, leadId, await unit({ saleModel: "spu" })))).toBe("BUSINESS_RULE");

      const lost = await leadOf(f.actors.agent1);
      await markLost(db, f.actors.manager, lost, { lostReasonId: f.lostReasonId });
      expect(await errorCode(book(f.actors.manager, lost, unitId))).toBe("BUSINESS_RULE");

      expect(await db.select().from(bookings)).toHaveLength(0);
      expect(await statusOf(unitId)).toBe("available");
      expect(await leadStage(leadId)).toBe("new_lead");
    });

    it("limits who can book and which leads they can use", async () => {
      const unitId = await unit();
      const leadA1 = await leadOf(f.actors.agent1);
      expect(await errorCode(book(f.actors.agent2, leadA1, unitId))).toBe("NOT_FOUND");
      expect(await errorCode(book(f.actors.outsideAgent, leadA1, unitId))).toBe("NOT_FOUND");
      expect(await errorCode(book(accountant, leadA1, unitId))).toBe("FORBIDDEN");
      expect(await errorCode(book(f.actors.hr, leadA1, unitId))).toBe("FORBIDDEN");
      expect(await statusOf(unitId)).toBe("available");

      const options = await bookingFormOptions(db, f.actors.agent2, f.projectId);
      expect(options.leads.map((l) => l.id)).not.toContain(leadA1);
      expect(options.units.map((u) => u.id)).toContain(unitId);
      await book(f.actors.manager, leadA1, unitId);
      expect((await bookingFormOptions(db, f.actors.manager, f.projectId)).units.map((u) => u.id)).not.toContain(unitId);
    });
  });

  describe("stages", () => {
    it("starts at Token and moves one step at a time; agents reach Complete Down Payment; managers close as won", async () => {
      const unitId = await unit();
      const leadId = await leadOf(f.actors.agent1);
      const { bookingId } = await book(f.actors.agent1, leadId, unitId);
      expect((await db.select().from(bookings).where(eq(bookings.id, bookingId)))[0].stage).toBe("token_pending");

      // No skipping (Token → Complete Down Payment), no retired stages, no cancelling by moving.
      expect(await errorCode(advanceBooking(db, f.actors.agent1, bookingId, { toStage: "agreement_pending" }))).toBe("BUSINESS_RULE");
      expect(await errorCode(advanceBooking(db, f.actors.agent1, bookingId, { toStage: "sales_order" }))).toBe("BUSINESS_RULE");
      expect(await errorCode(advanceBooking(db, f.actors.agent1, bookingId, { toStage: "cancelled" }))).toBe("BUSINESS_RULE");
      await advanceTo(f.actors.agent1, bookingId, PATH);
      expect(await errorCode(advanceBooking(db, f.actors.agent1, bookingId, { toStage: "confirmed" }))).toBe("FORBIDDEN");
      expect(await errorCode(advanceBooking(db, f.actors.agent2, bookingId, { toStage: "confirmed" }))).toBe("NOT_FOUND");

      const history = await db.select().from(bookingStageHistory).where(eq(bookingStageHistory.bookingId, bookingId));
      expect(history.map((h) => h.toStage)).toEqual(["token_pending", "down_payment", "agreement_pending"]);
      expect(await statusOf(unitId)).toBe("reserved");
    });

    it("lets only one of two concurrent moves on the same booking succeed", async () => {
      const { bookingId } = await book(f.actors.agent1, await leadOf(f.actors.agent1), await unit());
      const results = await Promise.allSettled([
        advanceBooking(db, f.actors.agent1, bookingId, { toStage: "down_payment" }),
        advanceBooking(db, f.actors.manager, bookingId, { toStage: "down_payment" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as AppError).code).toMatch(/BUSINESS_RULE|CONFLICT/);
      expect((await db.select().from(bookingStageHistory).where(eq(bookingStageHistory.bookingId, bookingId))).length).toBe(2);
    });

    it("confirming books the unit, books the lead and creates the client, and is final", async () => {
      const unitId = await unit();
      const leadId = await leadOf(f.actors.agent1, { email: "buyer@example.com" });
      const { bookingId } = await book(f.actors.agent1, leadId, unitId);
      await advanceTo(f.actors.manager, bookingId, PATH);
      const result = await advanceBooking(db, f.actors.manager, bookingId, { toStage: "confirmed", note: "All documents in" });

      expect(await statusOf(unitId)).toBe("booked");
      expect(await leadStage(leadId)).toBe("booked");
      const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId!));
      expect(client).toMatchObject({ ownerId: f.actors.agent1.id, email: "buyer@example.com" });
      const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(b.clientId).toBe(client.id);
      expect(b.confirmedAt).not.toBeNull();
      expect((await db.select().from(leads).where(eq(leads.id, leadId)))[0].clientId).toBe(client.id);

      expect(await errorCode(cancelBooking(db, f.actors.manager, bookingId, { reason: "Too late" }))).toBe("BUSINESS_RULE");
      expect(await errorCode(advanceBooking(db, f.actors.manager, bookingId, { toStage: "confirmed" }))).toBe("BUSINESS_RULE");
      expect(await errorCode(setUnitStatus(db, f.actors.superAdmin, unitId, { status: "sold", reason: "Paid in full" }))).toBe("BUSINESS_RULE");
    });

    it("links an existing client on confirm instead of creating a duplicate", async () => {
      // Same person: a client already exists with this phone (from a lead in another project).
      const earlier = await leadOf(f.actors.agent1, { phoneNumber: "0300 7771111", projectId: f.otherProjectId });
      const { clientId } = await convertLeadToClient(db, f.actors.manager, { leadId: earlier });
      const leadId = await leadOf(f.actors.agent1, { phoneNumber: "+92 300 777 1111" });
      const { bookingId } = await book(f.actors.agent1, leadId, await unit());
      await advanceTo(f.actors.manager, bookingId, [...PATH, "confirmed"]);

      expect((await db.select().from(clients)).length).toBe(1);
      expect((await db.select().from(bookings).where(eq(bookings.id, bookingId)))[0].clientId).toBe(clientId);

      // A lead already linked keeps its client.
      const manual = await createClient(db, f.actors.superAdmin, { name: "Walk-in", phoneCountryCode: "+92", phoneNumber: "3007772222", ownerId: f.actors.agent2.id });
      const lead2 = await leadOf(f.actors.agent2, { phoneNumber: "0300 7772222" });
      const second = await book(f.actors.agent2, lead2, await unit());
      await advanceTo(f.actors.manager, second.bookingId, [...PATH, "confirmed"]);
      expect((await db.select().from(bookings).where(eq(bookings.id, second.bookingId)))[0].clientId).toBe(manual.clientId);
    });
  });

  describe("cancellation", () => {
    it("releases the unit, keeps the lead stage, records the reason, and allows a new booking", async () => {
      const unitId = await unit();
      const leadId = await leadOf(f.actors.agent1);
      const { bookingId } = await book(f.actors.agent1, leadId, unitId);

      expect(await errorCode(cancelBooking(db, f.actors.agent1, bookingId, { reason: "Changed mind" }))).toBe("FORBIDDEN");
      expect(await errorCode(cancelBooking(db, f.actors.manager, bookingId, { reason: "" }))).toBe("VALIDATION_FAILED");
      expect(await errorCode(setUnitStatus(db, f.actors.superAdmin, unitId, { status: "available", reason: "override" }))).toBe("BUSINESS_RULE");

      await cancelBooking(db, f.actors.manager, bookingId, { reason: "Token not paid" });
      const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(b).toMatchObject({ stage: "cancelled", cancelledReason: "Token not paid" });
      expect(await statusOf(unitId)).toBe("available");
      expect(await leadStage(leadId)).toBe("booking_in_process");
      expect(await errorCode(cancelBooking(db, f.actors.manager, bookingId, { reason: "again" }))).toBe("BUSINESS_RULE");
      expect(await errorCode(updateBookingDetails(db, f.actors.manager, bookingId, { paymentInstructions: "x" }))).toBe("BUSINESS_RULE");

      const again = await book(f.actors.agent1, leadId, unitId);
      expect(again.bookingId).not.toBe(bookingId);
      expect(await statusOf(unitId)).toBe("reserved");
    });

    it("blocks a second active booking at the database level even if the unit status were bypassed", async () => {
      const unitId = await unit();
      const { bookingId } = await book(f.actors.agent1, await leadOf(f.actors.agent1), unitId);
      const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
      const copy: Partial<typeof b> = { ...b, leadId: await leadOf(f.actors.agent2) };
      delete copy.id;
      await expect(db.insert(bookings).values(copy as typeof b)).rejects.toThrow();
    });
  });

  describe("F-1: a lead's stage follows its open booking", () => {
    const OPEN_BOOKING = /open booking/;
    const msg = async (p: Promise<unknown>) => (await errorOf(p))?.message ?? "ok";

    it("refuses Lost (direct, agent request and approval) while the booking is open; nothing changes", async () => {
      const unitId = await unit();
      const leadId = await leadOf(f.actors.agent1);
      const { bookingId } = await book(f.actors.agent1, leadId, unitId);
      const activitiesBefore = (await db.select().from(leadActivities).where(eq(leadActivities.leadId, leadId))).length;

      expect(await msg(markLost(db, f.actors.manager, leadId, { lostReasonId: f.lostReasonId }))).toMatch(OPEN_BOOKING);
      expect(await msg(markLost(db, f.actors.superAdmin, leadId, { lostReasonId: f.lostReasonId }))).toMatch(OPEN_BOOKING);
      expect(await msg(markLost(db, f.actors.agent1, leadId, { lostReasonId: f.lostReasonId }))).toMatch(OPEN_BOOKING);
      expect(await pendingLostRequests(db, f.actors.manager, f.projectId)).toEqual([]);

      expect(await leadStage(leadId)).toBe("booking_in_process");
      expect(await statusOf(unitId)).toBe("reserved");
      expect((await db.select().from(bookings).where(eq(bookings.id, bookingId)))[0].stage).toBe("token_pending");
      expect((await db.select().from(leadActivities).where(eq(leadActivities.leadId, leadId))).length).toBe(activitiesBefore);
    });

    it("an agent's lost request made before the booking can't be approved while the booking is open, but can be rejected", async () => {
      const unitId = await unit();
      const leadId = await leadOf(f.actors.agent1);
      expect(await markLost(db, f.actors.agent1, leadId, { lostReasonId: f.lostReasonId })).toEqual({ status: "pending_approval" });
      const { bookingId } = await book(f.actors.manager, leadId, unitId);
      const [request] = await pendingLostRequests(db, f.actors.manager, f.projectId);

      expect(await msg(decideLostRequest(db, f.actors.manager, request.id, { approve: true }))).toMatch(OPEN_BOOKING);
      expect(await leadStage(leadId)).toBe("booking_in_process");
      expect(await pendingLostRequests(db, f.actors.manager, f.projectId)).toHaveLength(1); // still pending
      await decideLostRequest(db, f.actors.manager, request.id, { approve: false, comment: "Booking in progress" });
      expect(await pendingLostRequests(db, f.actors.manager, f.projectId)).toEqual([]);
      expect((await db.select().from(bookings).where(eq(bookings.id, bookingId)))[0].stage).toBe("token_pending");
    });

    it("refuses every other stage while the booking is open (pipeline drag / stage menu)", async () => {
      const leadId = await leadOf(f.actors.agent1);
      await book(f.actors.agent1, leadId, await unit());
      for (const stage of ["new_lead", "contacted", "qualified_lead", "meeting_scheduled", "meeting_done", "future_opportunity"]) {
        expect(await msg(changeStage(db, f.actors.manager, leadId, { stage })), stage).toMatch(OPEN_BOOKING);
      }
      expect(await leadStage(leadId)).toBe("booking_in_process");
    });

    it("meetings still save but never move a lead that has an open booking", async () => {
      // A lead left in an early stage with an open booking (data from before this rule): the booking is
      // moved onto it directly, as no service can produce this state any more.
      const { bookingId } = await book(f.actors.manager, await leadOf(f.actors.agent1), await unit());
      const early = await leadOf(f.actors.agent1);
      await db.update(bookings).set({ leadId: early }).where(eq(bookings.id, bookingId));
      const { meetingId } = await createMeeting(db, f.actors.agent1, { title: "Site visit", type: "site_visit", startsAt: new Date(Date.now() + 3_600_000).toISOString(), leadId: early, moveLead: true });
      expect(await leadStage(early)).toBe("new_lead");
      await completeMeeting(db, f.actors.agent1, meetingId, { moveLead: true });
      expect(await leadStage(early)).toBe("new_lead");
      // The one manual move allowed is back to Booking in Process, which repairs it.
      await changeStage(db, f.actors.manager, early, { stage: "booking_in_process" });
      expect(await leadStage(early)).toBe("booking_in_process");
    });

    it("the database refuses the same change from any other writer", async () => {
      const leadId = await leadOf(f.actors.agent1);
      await book(f.actors.agent1, leadId, await unit());
      await expect(db.update(leads).set({ stage: "lost_lead" }).where(eq(leads.id, leadId))).rejects.toThrow();
      await expect(db.update(leads).set({ stage: "contacted" }).where(eq(leads.id, leadId))).rejects.toThrow();
      expect(await leadStage(leadId)).toBe("booking_in_process");
    });

    it("leads without an open booking move freely; after cancelling, the unit is Available and the lead can be lost", async () => {
      const free = await leadOf(f.actors.agent1);
      await changeStage(db, f.actors.agent1, free, { stage: "contacted" });
      expect(await leadStage(free)).toBe("contacted");

      const unitId = await unit();
      const leadId = await leadOf(f.actors.agent1);
      const { bookingId } = await book(f.actors.agent1, leadId, unitId);
      await cancelBooking(db, f.actors.manager, bookingId, { reason: "Buyer withdrew before the token" });
      expect(await statusOf(unitId)).toBe("available");
      expect(await leadStage(leadId)).toBe("booking_in_process"); // left as is (29 Oct decision)
      await changeStage(db, f.actors.agent1, leadId, { stage: "future_opportunity" });
      expect(await markLost(db, f.actors.manager, leadId, { lostReasonId: f.lostReasonId })).toEqual({ status: "lost" });
      expect(await leadStage(leadId)).toBe("lost_lead");
      // The released unit can be booked again by another lead.
      const other = await leadOf(f.actors.agent1);
      await book(f.actors.agent1, other, unitId);
      expect(await statusOf(unitId)).toBe("reserved");
    });

    it("a confirmed booking leaves the lead Booked and still locked; a confirmed lead with no open booking is unchanged", async () => {
      const unitId = await unit();
      const leadId = await leadOf(f.actors.agent1);
      const { bookingId } = await book(f.actors.agent1, leadId, unitId);
      await advanceTo(f.actors.manager, bookingId, [...PATH, "confirmed"]);
      expect(await leadStage(leadId)).toBe("booked");
      expect(await statusOf(unitId)).toBe("booked");
      expect(await errorCode(markLost(db, f.actors.manager, leadId, { lostReasonId: f.lostReasonId }))).toBe("BUSINESS_RULE");
      expect(await errorCode(changeStage(db, f.actors.manager, leadId, { stage: "contacted" }))).toBe("BUSINESS_RULE");
    });

    it("concurrent Lost and booking: one wins, and lead, booking and unit always agree", async () => {
      for (let i = 0; i < 6; i++) {
        const unitId = await unit();
        const leadId = await leadOf(f.actors.agent1);
        const results = await Promise.allSettled([
          markLost(db, f.actors.manager, leadId, { lostReasonId: f.lostReasonId }),
          book(f.actors.manager, leadId, unitId),
        ]);
        expect(results.filter((r) => r.status === "fulfilled"), `round ${i}`).toHaveLength(1);
        for (const r of results) if (r.status === "rejected") expect(r.reason, `round ${i}`).toBeInstanceOf(AppError);
        const open = await db.select().from(bookings).where(and(eq(bookings.leadId, leadId)));
        if (open.length) {
          expect([await leadStage(leadId), await statusOf(unitId)], `round ${i}`).toEqual(["booking_in_process", "reserved"]);
        } else {
          expect([await leadStage(leadId), await statusOf(unitId)], `round ${i}`).toEqual(["lost_lead", "available"]);
        }
      }
    });

    it("concurrent stage move and booking never leave the lead outside Booking in Process", async () => {
      for (let i = 0; i < 6; i++) {
        const unitId = await unit();
        const leadId = await leadOf(f.actors.agent1);
        await Promise.allSettled([changeStage(db, f.actors.manager, leadId, { stage: "contacted" }), book(f.actors.manager, leadId, unitId)]);
        expect(await leadStage(leadId), `round ${i}`).toBe("booking_in_process");
        expect(await statusOf(unitId), `round ${i}`).toBe("reserved");
      }
    });
  });

  describe("visibility, details and money", () => {
    it("scopes lists by sales agent and shows no payments until Finance exists", async () => {
      const b1 = (await book(f.actors.agent1, await leadOf(f.actors.agent1), await unit())).bookingId;
      const b2 = (await book(f.actors.agent2, await leadOf(f.actors.agent2), await unit())).bookingId;
      const b3 = (await book(f.actors.outsideAgent, await leadOf(f.actors.outsideAgent), await unit())).bookingId;
      const ids = async (actor: Actor, q: Record<string, string> = {}) => (await listBookings(db, actor, q, f.projectId, TODAY)).rows.map((r) => r.id).sort();

      expect(await ids(f.actors.agent1)).toEqual([b1]);
      expect(await ids(f.actors.manager)).toEqual([b1, b2].sort());
      expect(await ids(f.actors.superAdmin)).toEqual([b1, b2, b3].sort());
      expect(await ids(accountant)).toEqual([b1, b2, b3].sort());
      expect(await errorCode(listBookings(db, f.actors.hr, {}, f.projectId, TODAY))).toBe("FORBIDDEN");
      expect(await errorCode(getBookingDetail(db, f.actors.manager, b3, TODAY))).toBe("NOT_FOUND");
      expect(await ids(f.actors.superAdmin, { stage: "down_payment" })).toEqual([]);
      expect(await ids(f.actors.superAdmin, { stage: "token_pending" })).toEqual([b1, b2, b3].sort());

      const detail = await getBookingDetail(db, accountant, b1, TODAY);
      expect(detail.money).toEqual({ paid: 0, total: 12_500_000, outstanding: 12_500_000, milestoneMet: false });
      expect(detail.permissions).toMatchObject({ advance: false, cancel: false, editDetails: false });
      expect(await errorCode(advanceBooking(db, accountant, b1, { toStage: "down_payment" }))).toBe("FORBIDDEN");
    });

    it("updates overview fields (managers / admins), flags overdue holds, and keeps rate and token fixed", async () => {
      const { bookingId } = await book(f.actors.agent1, await leadOf(f.actors.agent1), await unit());
      expect(await errorCode(updateBookingDetails(db, f.actors.agent1, bookingId, { paymentDocsStatus: "submitted" }))).toBe("FORBIDDEN");
      expect(
        await updateBookingDetails(db, f.actors.manager, bookingId, { paymentDocsStatus: "submitted", agreementSentOn: "2026-10-29", ratePerSqft: "1" }),
      ).toEqual({ changed: ["agreementSentOn", "paymentDocsStatus"] });
      const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(b.ratePerSqft).toBe(25_000);

      expect((await getBookingDetail(db, f.actors.manager, bookingId, "2099-02-01")).holdOverdue).toBe(true);
      expect((await getBookingDetail(db, f.actors.manager, bookingId, TODAY)).holdOverdue).toBe(false);
    });
  });
});
