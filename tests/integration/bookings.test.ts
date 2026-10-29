import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, cancelBooking, createBooking, updateBookingDetails } from "@/modules/bookings/commands";
import { bookingFormOptions, getBookingDetail, listBookings } from "@/modules/bookings/queries";
import { convertLeadToClient, createClient } from "@/modules/clients/commands";
import { createUnit, setUnitStatus } from "@/modules/inventory/commands";
import { createLead, markLost } from "@/modules/leads/commands";
import { hashPassword } from "@/server/auth/password";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, bookingStageHistory, bookings, clients, leads, units, users } from "@/server/db/schema";
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
const PATH = ["token_pending", "token_received", "provisional_receipt", "sales_order", "booking_form", "down_payment", "agreement_pending"] as const;

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
    for (const s of stages) await advanceBooking(db, actor, bookingId, { toStage: s });
  };

  describe("create and reservation", () => {
    it("books an Available unit: unit Reserved, lead Booking in Process, total = area × rate, history and audit", async () => {
      const unitId = await unit();
      const leadId = await leadOf(f.actors.agent1);
      const { bookingId } = await book(f.actors.agent1, leadId, unitId, { paymentInstructions: "Bank transfer to escrow" });

      const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(b).toMatchObject({ stage: "negotiation", areaSqft: 500, ratePerSqft: 25_000, totalSale: 12_500_000, tokenAmount: 500_000, agentId: f.actors.agent1.id, clientId: null });
      expect(await statusOf(unitId)).toBe("reserved");
      expect(await leadStage(leadId)).toBe("booking_in_process");
      const history = await db.select().from(bookingStageHistory).where(eq(bookingStageHistory.bookingId, bookingId));
      expect(history.map((h) => [h.fromStage, h.toStage])).toEqual([[null, "negotiation"]]);
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
    it("moves one step at a time; agents stop at Sales order; managers confirm", async () => {
      const unitId = await unit();
      const leadId = await leadOf(f.actors.agent1);
      const { bookingId } = await book(f.actors.agent1, leadId, unitId);

      expect(await errorCode(advanceBooking(db, f.actors.agent1, bookingId, { toStage: "token_received" }))).toBe("BUSINESS_RULE");
      expect(await errorCode(advanceBooking(db, f.actors.agent1, bookingId, { toStage: "cancelled" }))).toBe("BUSINESS_RULE");
      await advanceTo(f.actors.agent1, bookingId, PATH.slice(0, 4));
      expect(await errorCode(advanceBooking(db, f.actors.agent1, bookingId, { toStage: "booking_form" }))).toBe("FORBIDDEN");
      await advanceTo(f.actors.manager, bookingId, PATH.slice(4));
      expect(await errorCode(advanceBooking(db, f.actors.agent2, bookingId, { toStage: "confirmed" }))).toBe("NOT_FOUND");

      const history = await db.select().from(bookingStageHistory).where(eq(bookingStageHistory.bookingId, bookingId));
      expect(history).toHaveLength(1 + PATH.length);
      expect(await statusOf(unitId)).toBe("reserved");
    });

    it("lets only one of two concurrent moves on the same booking succeed", async () => {
      const { bookingId } = await book(f.actors.agent1, await leadOf(f.actors.agent1), await unit());
      const results = await Promise.allSettled([
        advanceBooking(db, f.actors.agent1, bookingId, { toStage: "token_pending" }),
        advanceBooking(db, f.actors.manager, bookingId, { toStage: "token_pending" }),
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
      await advanceBooking(db, f.actors.agent1, bookingId, { toStage: "token_pending" });

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
      expect(await ids(f.actors.superAdmin, { stage: "token_pending" })).toEqual([]);

      const detail = await getBookingDetail(db, accountant, b1, TODAY);
      expect(detail.money).toEqual({ paid: 0, total: 12_500_000, outstanding: 12_500_000, milestoneMet: false });
      expect(detail.permissions).toMatchObject({ advance: false, cancel: false, editDetails: false });
      expect(await errorCode(advanceBooking(db, accountant, b1, { toStage: "token_pending" }))).toBe("FORBIDDEN");
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
