import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, cancelBooking, createBooking } from "@/modules/bookings/commands";
import { bookingsFor } from "@/modules/bookings/queries";
import { convertLeadToClient, createClient } from "@/modules/clients/commands";
import { getClientDetail, listClients } from "@/modules/clients/queries";
import { decideReversal, recordPayment, requestReversal } from "@/modules/finance/commands";
import { bookingPaymentHistory, listPaymentMethods } from "@/modules/finance/queries";
import { createUnit } from "@/modules/inventory/commands";
import { assignLead, createLead } from "@/modules/leads/commands";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, bookingPayments, bookings, clientActivities, clients, leads, units, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};
const PATH = ["down_payment", "agreement_pending", "confirmed"];
const TODAY = "2026-10-15";

describe.skipIf(!hasTestDb)("F-13: a client's open bookings and payments (FR-051, FR-052, FR-204, PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let accountant: Actor;
  let cashId: string;
  let unitCounter = 0;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [u] = await db.insert(users).values({ name: "Acc", email: "acc@test.local", role: "accountant", passwordHash: "x" }).returning();
    accountant = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    cashId = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash")!.id;
  });

  const newLead = async (owner: Actor = f.actors.agent1, extra: Record<string, unknown> = {}, projectId = f.projectId) => {
    const r = await createLead(db, f.actors.superAdmin, leadInput(f, { projectId, ownerId: owner.id, ...extra }));
    if (r.outcome !== "created") throw new Error("lead");
    return r.leadId;
  };
  const book = async (leadId: string, actor: Actor = f.actors.agent1, projectId = f.projectId) => {
    unitCounter += 1;
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId, unitNo: `CB-${unitCounter}`, areaSqft: "1000", basePrice: "1000000" });
    const { bookingId } = await createBooking(db, actor, { projectId, leadId, unitId, ratePerSqft: "1000", tokenAmount: "50000" });
    return { bookingId, unitId };
  };
  const linkOf = async (bookingId: string) => (await db.select({ clientId: bookings.clientId }).from(bookings).where(eq(bookings.id, bookingId)))[0].clientId;
  const leadClient = async (leadId: string) => (await db.select({ clientId: leads.clientId }).from(leads).where(eq(leads.id, leadId)))[0].clientId;
  const unitStatus = async (unitId: string) => (await db.select({ status: units.status }).from(units).where(eq(units.id, unitId)))[0].status;
  const clientCount = async () => (await db.select({ id: clients.id }).from(clients)).length;
  const pay = (bookingId: string, amount: string, type = "token") => recordPayment(db, accountant, { bookingId, type, amount, receivedOn: TODAY, methodId: cashId });
  const toConfirmed = async (bookingId: string) => {
    for (const toStage of PATH) await advanceBooking(db, f.actors.manager, bookingId, { toStage });
  };
  const existingClient = async (leadId: string) => (await convertLeadToClient(db, f.actors.superAdmin, { leadId })).clientId;

  describe("when the link is made", () => {
    it("an existing client sees a new open booking at once, in the page, the list and the project filter", async () => {
      const leadId = await newLead();
      const clientId = await existingClient(leadId);
      const { bookingId, unitId } = await book(leadId);
      expect(await linkOf(bookingId)).toBe(clientId);
      expect((await bookingsFor(db, f.actors.superAdmin, { clientId })).map((b) => [b.id, b.stage])).toEqual([[bookingId, "token_pending"]]);
      const row = (await listClients(db, f.actors.superAdmin, {})).rows.find((r) => r.id === clientId);
      expect(row?.latestInvestment).toMatchObject({ bookingId, stage: "token_pending" });
      expect((await listClients(db, f.actors.superAdmin, { project: f.projectId })).rows.map((r) => r.id)).toEqual([clientId]);
      expect(await unitStatus(unitId)).toBe("reserved");
      const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "booking.create"), eq(auditLogs.entityId, bookingId)));
      expect(audit.after).toMatchObject({ clientId });
    });

    it("a repeat buyer's new lead joins their client at once (matched by phone), without a second client", async () => {
      const first = await newLead(f.actors.agent1, { phoneNumber: "03001234567" });
      const clientId = await existingClient(first);
      // Every lead belongs to its person's client (13 Nov 2026); the repeat buyer stays with their agent.
      const r = await createLead(db, f.actors.superAdmin, leadInput(f, { projectId: f.otherProjectId, phoneNumber: "0300 1234567" }));
      if (r.outcome !== "created") throw new Error("lead");
      expect(await leadClient(r.leadId)).toBe(clientId);
      const { bookingId } = await book(r.leadId, f.actors.superAdmin, f.otherProjectId);
      expect(await linkOf(bookingId)).toBe(clientId);
      expect(await clientCount()).toBe(1);
      expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "client.link_lead"), eq(auditLogs.entityId, clientId)))).toHaveLength(1);
      expect((await db.select().from(clientActivities).where(eq(clientActivities.clientId, clientId))).map((a) => a.type)).toContain("lead_linked");
    });

    it("a new buyer's client starts with their first lead, and their bookings link to it at once", async () => {
      const leadId = await newLead();
      const clientId = await leadClient(leadId);
      expect(clientId).not.toBeNull();
      const open = await book(leadId);
      const second = await book(leadId);
      expect(await linkOf(open.bookingId)).toBe(clientId);
      expect(await linkOf(second.bookingId)).toBe(clientId);
      expect(await clientCount()).toBe(1);
      // Converting is no longer needed; it returns the same client.
      expect(await convertLeadToClient(db, f.actors.superAdmin, { leadId })).toEqual({ outcome: "linked", clientId });
    });
  });

  describe("payments on the client page", () => {
    it("shows the token and later payments, and reversals keep the totals right", async () => {
      const leadId = await newLead();
      const clientId = await existingClient(leadId);
      const { bookingId } = await book(leadId);
      const token = await pay(bookingId, "50000");
      await pay(bookingId, "100000", "installment");

      const [row] = await bookingsFor(db, f.actors.manager, { clientId });
      expect(row).toMatchObject({ id: bookingId, paid: 150000, total: 1000000, outstanding: 850000 });
      const history = await bookingPaymentHistory(db, f.actors.manager, row.id);
      expect(history?.map((p) => [p.kind, Number(p.amount)])).toEqual([["payment", 50000], ["payment", 100000]]);

      const { requestId } = await requestReversal(db, accountant, token.paymentId, { reason: "Entered against the wrong booking" });
      await decideReversal(db, f.actors.superAdmin, requestId, { approve: true });
      const [after] = await bookingsFor(db, f.actors.manager, { clientId });
      expect(after).toMatchObject({ paid: 100000, outstanding: 900000 });
      expect((await bookingPaymentHistory(db, f.actors.manager, row.id))?.map((p) => p.kind)).toEqual(["payment", "payment", "reversal"]);
    });

    it("a client with several bookings sees each one with its own payments", async () => {
      const leadId = await newLead();
      const clientId = await existingClient(leadId);
      const a = await book(leadId);
      const b = await book(leadId);
      await pay(a.bookingId, "10000");
      await pay(b.bookingId, "20000");
      const rows = await bookingsFor(db, f.actors.superAdmin, { clientId });
      expect(Object.fromEntries(rows.map((r) => [r.id, r.paid]))).toEqual({ [a.bookingId]: 10000, [b.bookingId]: 20000 });
    });
  });

  describe("the rest of the lifecycle is unchanged", () => {
    it("confirmation keeps the same client, with no second link, and books the unit", async () => {
      const leadId = await newLead();
      const clientId = await existingClient(leadId);
      const { bookingId, unitId } = await book(leadId);
      await toConfirmed(bookingId);
      expect(await linkOf(bookingId)).toBe(clientId);
      expect(await clientCount()).toBe(1);
      expect(await unitStatus(unitId)).toBe("booked");
      expect((await bookingsFor(db, f.actors.superAdmin, { clientId })).map((b) => b.stage)).toEqual(["confirmed"]);
    });

    it("a new buyer's confirmation still creates the client and links every open booking of the lead", async () => {
      const leadId = await newLead();
      const a = await book(leadId);
      const b = await book(leadId);
      await toConfirmed(a.bookingId);
      const clientId = await leadClient(leadId);
      expect(clientId).not.toBeNull();
      expect(await linkOf(a.bookingId)).toBe(clientId);
      expect(await linkOf(b.bookingId)).toBe(clientId);
      expect(await clientCount()).toBe(1);
    });

    it("a cancelled booking leaves the client page and frees the unit; the next booking still links", async () => {
      const leadId = await newLead();
      const clientId = await existingClient(leadId);
      const { bookingId, unitId } = await book(leadId);
      await cancelBooking(db, f.actors.manager, bookingId, { reason: "Buyer withdrew" });
      expect(await bookingsFor(db, f.actors.superAdmin, { clientId })).toEqual([]);
      expect((await listClients(db, f.actors.superAdmin, {})).rows.find((r) => r.id === clientId)?.latestInvestment).toBeNull();
      expect(await unitStatus(unitId)).toBe("available");
      // Still listed where it always was: on the lead.
      expect((await bookingsFor(db, f.actors.superAdmin, { leadId })).map((b) => b.stage)).toEqual(["cancelled"]);
      const next = await book(leadId);
      expect((await bookingsFor(db, f.actors.superAdmin, { clientId })).map((b) => b.id)).toEqual([next.bookingId]);
    });

    it("a booking with money still can't be cancelled", async () => {
      const leadId = await newLead();
      await existingClient(leadId);
      const { bookingId } = await book(leadId);
      await pay(bookingId, "1000");
      expect(await errorCode(cancelBooking(db, f.actors.manager, bookingId, { reason: "x y z" }))).toBe("BUSINESS_RULE");
    });
  });

  describe("access", () => {
    it("the client's owner doesn't see another team's booking on the client page; those who may, do", async () => {
      const mine = await newLead(f.actors.agent1, { phoneNumber: "03005551234" });
      const clientId = await existingClient(mine);
      // The person's next inquiry goes to their agent; a Super Admin then moves it to another team.
      const r = await createLead(db, f.actors.superAdmin, leadInput(f, { projectId: f.otherProjectId, phoneNumber: "03005551234" }));
      if (r.outcome !== "created") throw new Error("lead");
      await assignLead(db, f.actors.superAdmin, r.leadId, { ownerId: f.actors.outsideAgent.id });
      const { bookingId } = await book(r.leadId, f.actors.superAdmin, f.otherProjectId);
      expect(await linkOf(bookingId)).toBe(clientId);

      expect(await bookingsFor(db, f.actors.agent1, { clientId })).toEqual([]);
      expect(await bookingsFor(db, f.actors.manager, { clientId })).toEqual([]);
      expect(await errorCode(bookingPaymentHistory(db, f.actors.manager, bookingId))).toBe("NOT_FOUND");
      expect((await listClients(db, f.actors.agent1, {})).rows.find((r) => r.id === clientId)?.latestInvestment).toBeNull();
      expect((await bookingsFor(db, f.actors.superAdmin, { clientId })).map((b) => b.id)).toEqual([bookingId]);
      // Agents get no itemised payments, and a client outside their scope stays hidden.
      expect(await bookingPaymentHistory(db, f.actors.agent1, bookingId)).toBeNull();
      expect(await errorCode(getClientDetail(db, f.actors.agent2, clientId))).toBe("NOT_FOUND");
    });
  });

  describe("existing records", () => {
    it("bookings made before this fix stay as they are, and link the next time the lead's client is resolved; payments are never touched", async () => {
      const leadId = await newLead();
      const clientId = await existingClient(leadId);
      const { bookingId } = await book(leadId);
      await pay(bookingId, "50000");
      await db.update(bookings).set({ clientId: null }).where(eq(bookings.id, bookingId)); // as stored before the fix
      const payments = await db.select().from(bookingPayments).where(eq(bookingPayments.bookingId, bookingId));

      expect(await bookingsFor(db, f.actors.superAdmin, { clientId })).toEqual([]);
      await book(leadId);
      expect(await linkOf(bookingId)).toBe(clientId);
      expect(await db.select().from(bookingPayments).where(eq(bookingPayments.bookingId, bookingId))).toEqual(payments);
    });

    it("a client created by hand keeps working: an unlinked lead with the same phone links when booked", async () => {
      const { clientId } = await createClient(db, f.actors.superAdmin, { name: "Walk-in", phoneCountryCode: "+92", phoneNumber: "03004443322", ownerId: f.actors.agent1.id });
      const leadId = await newLead(f.actors.agent1, { phoneNumber: "03004443322" });
      const { bookingId } = await book(leadId);
      expect(await linkOf(bookingId)).toBe(clientId);
    });
  });

  describe("concurrency", () => {
    it("a conversion racing a new booking always ends linked", async () => {
      for (let round = 0; round < 5; round++) {
        const leadId = await newLead();
        unitCounter += 1;
        const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: `CB-${unitCounter}`, areaSqft: "1000", basePrice: "1000000" });
        const [{ bookingId }, { clientId }] = await Promise.all([
          createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId, unitId, ratePerSqft: "1000", tokenAmount: "50000" }),
          convertLeadToClient(db, f.actors.superAdmin, { leadId }),
        ]);
        expect(await linkOf(bookingId)).toBe(clientId);
      }
    });

    it("a conversion racing confirmation leaves one client and one link, without a deadlock", async () => {
      for (let round = 0; round < 5; round++) {
        const leadId = await newLead();
        const { bookingId } = await book(leadId);
        for (const toStage of PATH.slice(0, -1)) await advanceBooking(db, f.actors.manager, bookingId, { toStage });
        const before = await clientCount();
        const results = await Promise.allSettled([advanceBooking(db, f.actors.manager, bookingId, { toStage: "confirmed" }), convertLeadToClient(db, f.actors.superAdmin, { leadId })]);
        expect(results[0].status).toBe("fulfilled");
        expect(results[1].status).toBe("fulfilled");
        // The lead already had its client, so neither creates another.
        expect(await clientCount()).toBe(before);
        expect(await linkOf(bookingId)).toBe(await leadClient(leadId));
      }
    });
  });
});
