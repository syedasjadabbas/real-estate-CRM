import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, cancelBooking, createBooking } from "@/modules/bookings/commands";
import { getBookingDetail, listBookings } from "@/modules/bookings/queries";
import { addPaymentMethod, decideReversal, recordPayment, requestReversal, setPaymentMethodActive, updateFinanceSettings } from "@/modules/finance/commands";
import { bookingPaymentHistory, listPaymentMethods, listPayments, reversalRequestsForActor } from "@/modules/finance/queries";
import { getPaymentDetail, outstandingBookings, payableBookings, scheduleDueByBooking } from "@/modules/finance/views";
import { businessToday } from "@/modules/bookings/today";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { hashPassword } from "@/server/auth/password";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, bookingPayments, paymentReversalRequests, taskInstallmentRows, tasks, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor, Role } from "@/server/auth/types";
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

describe.skipIf(!hasTestDb)("Finance F1: booking payments (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let accountant: Actor;
  let admin: Actor;
  let cashId: string;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const make = async (name: string, email: string, role: Role) => {
      const [u] = await db.insert(users).values({ name, email, role, passwordHash: await hashPassword("x-y-z-w-v") }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    accountant = await make("Accountant", "acc@test.local", "accountant");
    admin = await make("Admin", "admin@test.local", "admin");
    // Methods are seeded by migration 0005 (not truncated between tests).
    cashId = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash")!.id;
  });

  /** A booking for agent1's lead on a 500 sq ft unit at 25,000 → total 12,500,000, moved to `stages`. */
  const bookingAt = async (stages: string[] = ["token_pending"], owner: Actor = f.actors.agent1) => {
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: `U-${Math.random().toString(36).slice(2, 8)}`, areaSqft: "500", basePrice: "1" });
    const lead = await createLead(db, owner, leadInput(f));
    if (lead.outcome !== "created") throw new Error("setup");
    const { bookingId } = await createBooking(db, owner, { projectId: f.projectId, leadId: lead.leadId, unitId, ratePerSqft: "25000", tokenAmount: "500000" });
    for (const s of stages) await advanceBooking(db, f.actors.superAdmin, bookingId, { toStage: s });
    return bookingId;
  };
  const pay = (bookingId: string, amount: string, extra: Record<string, unknown> = {}, actor: Actor = accountant) =>
    recordPayment(db, actor, { bookingId, type: "token", amount, receivedOn: TODAY, methodId: cashId, ...extra });
  const paidOf = async (bookingId: string) => (await getBookingDetail(db, f.actors.superAdmin, bookingId, TODAY)).money;

  describe("recording", () => {
    it("posts a payment with a receipt number; Bookings derives Paid, outstanding and the milestone from it", async () => {
      const bookingId = await bookingAt();
      expect(await paidOf(bookingId)).toEqual({ paid: 0, total: 12_500_000, outstanding: 12_500_000, milestoneMet: false });

      const { paymentId, receiptNo } = await pay(bookingId, "500,000", { reference: "TXN-1" });
      expect(receiptNo).toBeGreaterThan(0);
      expect(await paidOf(bookingId)).toMatchObject({ paid: 500_000, outstanding: 12_000_000, milestoneMet: false });
      const listed = (await listBookings(db, f.actors.agent1, {}, f.projectId, TODAY)).rows.find((r) => r.id === bookingId);
      expect(listed).toMatchObject({ paid: 500_000 });

      const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, paymentId), eq(auditLogs.action, "payment.record")));
      expect(audit.after).toMatchObject({ amount: 500_000, receiptNo, paidBefore: 0, paidAfter: 500_000, method: "Cash" });
    });

    it("turns the 30% milestone on exactly at 30% of the total", async () => {
      const bookingId = await bookingAt();
      await pay(bookingId, "3749999.99", { type: "down_payment" });
      expect((await paidOf(bookingId)).milestoneMet).toBe(false);
      await pay(bookingId, "0.01", { type: "down_payment" });
      expect((await paidOf(bookingId)).milestoneMet).toBe(true);
    });

    it("rejects payments by stage, amount, date, method and role", async () => {
      const negotiation = await bookingAt([]);
      expect(await errorCode(pay(negotiation, "1000"))).toBe("BUSINESS_RULE");

      const bookingId = await bookingAt();
      const over = await errorOf(pay(bookingId, "12500000.01"));
      expect(over?.fields).toHaveProperty("amount");
      expect((await errorOf(pay(bookingId, "1000", { receivedOn: "2099-01-01" })))?.fields).toHaveProperty("receivedOn");
      expect((await errorOf(pay(bookingId, "0")))?.fields).toHaveProperty("amount");
      expect((await errorOf(pay(bookingId, "1.234")))?.fields).toHaveProperty("amount");

      const { methodId } = await addPaymentMethod(db, f.actors.superAdmin, { name: `Test method ${Math.random().toString(36).slice(2, 7)}` });
      await setPaymentMethodActive(db, f.actors.superAdmin, methodId, false);
      expect((await errorOf(pay(bookingId, "1000", { methodId })))?.fields).toHaveProperty("methodId");

      for (const actor of [admin, f.actors.manager, f.actors.agent1, f.actors.hr]) {
        expect(await errorCode(pay(bookingId, "1000", {}, actor))).toBe("FORBIDDEN");
      }
      expect(await errorCode(pay(bookingId, "1000", {}, f.actors.superAdmin))).toBe("ok");

      await pay(bookingId, "12499000");
      expect((await errorOf(pay(bookingId, "1")))?.fields?.amount).toBe("This booking is fully paid");
      expect(await db.select().from(bookingPayments).where(eq(bookingPayments.bookingId, bookingId))).toHaveLength(2);
    });

    it("accepts payments on Confirmed bookings and refuses them on Cancelled ones", async () => {
      const confirmed = await bookingAt(["token_pending", "token_received", "provisional_receipt", "sales_order", "booking_form", "down_payment", "agreement_pending", "confirmed"]);
      expect(await errorCode(pay(confirmed, "1000", { type: "installment" }))).toBe("ok");
      const cancelled = await bookingAt();
      await cancelBooking(db, f.actors.manager, cancelled, { reason: "Changed mind" });
      expect(await errorCode(pay(cancelled, "1000"))).toBe("BUSINESS_RULE");
    });
  });

  describe("concurrency and idempotency", () => {
    it("never lets concurrent payments exceed the outstanding balance", async () => {
      const bookingId = await bookingAt();
      // Each alone fits (7M ≤ 12.5M) but together they don't.
      const results = await Promise.allSettled([pay(bookingId, "7000000"), pay(bookingId, "7000000")]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect((rejected.reason as AppError).fields).toHaveProperty("amount");
      expect((await paidOf(bookingId)).paid).toBe(7_000_000);
    });

    it("gives concurrent payments that both fit distinct, increasing receipt numbers", async () => {
      const bookingId = await bookingAt();
      const results = await Promise.all([pay(bookingId, "1000"), pay(bookingId, "2000"), pay(bookingId, "3000")]);
      const numbers = results.map((r) => r.receiptNo);
      expect(new Set(numbers).size).toBe(3);
      expect((await paidOf(bookingId)).paid).toBe(6000);
    });

    it("returns the first result for a repeated idempotency key, even when the repeats race", async () => {
      const bookingId = await bookingAt();
      const key = "submit-abc-123";
      const results = await Promise.all([pay(bookingId, "1000", { idempotencyKey: key }), pay(bookingId, "1000", { idempotencyKey: key })]);
      expect(results[0].paymentId).toBe(results[1].paymentId);
      expect(await db.select().from(bookingPayments).where(eq(bookingPayments.bookingId, bookingId))).toHaveLength(1);
      expect((await pay(bookingId, "1000", { idempotencyKey: key })).replayed).toBe(true);
      expect(await errorCode(pay(bookingId, "2000", { idempotencyKey: key }))).toBe("CONFLICT");
    });
  });

  describe("immutability (database level)", () => {
    it("rejects UPDATE and DELETE on posted payments and unapproved or mismatched reversals", async () => {
      const bookingId = await bookingAt();
      const { paymentId } = await pay(bookingId, "1000");
      await expect(db.update(bookingPayments).set({ amount: 1 }).where(eq(bookingPayments.id, paymentId))).rejects.toThrow();
      await expect(db.delete(bookingPayments).where(eq(bookingPayments.id, paymentId))).rejects.toThrow();
      const forged = {
        bookingId,
        kind: "reversal" as const,
        type: "token" as const,
        amount: 1000,
        receivedOn: TODAY,
        note: "forged",
        reversalRef: sql`nextval('booking_payment_reversal_ref_seq')`,
        reversalOfId: paymentId,
        recordedById: accountant.id,
      };
      await expect(db.insert(bookingPayments).values(forged)).rejects.toThrow();
      expect((await paidOf(bookingId)).paid).toBe(1000);
    });
  });

  describe("reversals (request → approve)", () => {
    it("needs a request by finance and a decision by a manager of the team or an admin; audits both", async () => {
      const bookingId = await bookingAt();
      const { paymentId, receiptNo } = await pay(bookingId, "500000");

      expect(await errorCode(requestReversal(db, f.actors.agent1, paymentId, { reason: "wrong amount" }))).toBe("FORBIDDEN");
      expect(await errorCode(requestReversal(db, accountant, paymentId, { reason: "no" }))).toBe("VALIDATION_FAILED");
      const { requestId } = await requestReversal(db, accountant, paymentId, { reason: "Entered against the wrong booking" });
      expect(await errorCode(requestReversal(db, accountant, paymentId, { reason: "Entered twice by mistake" }))).toBe("CONFLICT");
      expect((await paidOf(bookingId)).paid).toBe(500_000);

      expect(await errorCode(decideReversal(db, accountant, requestId, { approve: true }))).toBe("FORBIDDEN");
      expect(await errorCode(decideReversal(db, f.actors.agent1, requestId, { approve: true }))).toBe("FORBIDDEN");
      expect((await reversalRequestsForActor(db, f.actors.manager)).map((r) => r.id)).toEqual([requestId]);

      const decision = await decideReversal(db, f.actors.manager, requestId, { approve: true, note: "Checked bank statement" });
      expect(decision.status).toBe("approved");
      expect(decision.reversalRef).toBeGreaterThan(0);
      expect(await paidOf(bookingId)).toMatchObject({ paid: 0, outstanding: 12_500_000 });

      const history = (await bookingPaymentHistory(db, accountant, bookingId))!;
      expect(history.map((h) => [h.kind, h.amount])).toEqual([
        ["payment", 500_000],
        ["reversal", 500_000],
      ]);
      expect(history[0].reversed).toBe(true);
      expect(history[1].originalReceipt).toBe(String(receiptNo));
      const actions = (await db.select().from(auditLogs).where(eq(auditLogs.entityId, paymentId))).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["payment.record", "payment.reversal_requested", "payment.reversal_approved"]));

      expect(await errorCode(decideReversal(db, admin, requestId, { approve: false }))).toBe("BUSINESS_RULE");
      expect(await errorCode(requestReversal(db, accountant, paymentId, { reason: "Again please" }))).toBe("BUSINESS_RULE");
      expect(await errorCode(requestReversal(db, accountant, decision.reversalId!, { reason: "Reverse the reversal" }))).toBe("BUSINESS_RULE");
      await expect(db.update(paymentReversalRequests).set({ status: "pending", decidedAt: null }).where(eq(paymentReversalRequests.id, requestId))).rejects.toThrow();
    });

    it("keeps the payment when a reversal is rejected, and hides other teams' requests from a manager", async () => {
      const outside = await bookingAt(["token_pending"], f.actors.outsideAgent);
      const { paymentId } = await pay(outside, "1000");
      const { requestId } = await requestReversal(db, accountant, paymentId, { reason: "Possible duplicate" });
      expect(await reversalRequestsForActor(db, f.actors.manager)).toEqual([]);
      expect(await errorCode(decideReversal(db, f.actors.manager, requestId, { approve: true }))).toBe("NOT_FOUND");
      expect(await errorCode(bookingPaymentHistory(db, f.actors.manager, outside))).toBe("NOT_FOUND");

      expect((await decideReversal(db, admin, requestId, { approve: false, note: "Not a duplicate" })).status).toBe("rejected");
      expect((await paidOf(outside)).paid).toBe(1000);
      const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, paymentId), eq(auditLogs.action, "payment.reversal_rejected")));
      expect(audit).toBeTruthy();
    });

    it("lets a super admin approve their own request as an audited emergency action", async () => {
      const bookingId = await bookingAt();
      const { paymentId } = await pay(bookingId, "1000", {}, f.actors.superAdmin);
      const { requestId } = await requestReversal(db, f.actors.superAdmin, paymentId, { reason: "Emergency correction" });
      expect((await decideReversal(db, f.actors.superAdmin, requestId, { approve: true })).status).toBe("approved");
      const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, paymentId), eq(auditLogs.action, "payment.reversal_approved_emergency")));
      expect(audit).toBeTruthy();
    });
  });

  describe("bookings integration and settings", () => {
    it("blocks cancelling a booking with net payments; allows it once every payment is reversed", async () => {
      const bookingId = await bookingAt();
      const { paymentId } = await pay(bookingId, "500000");
      const blocked = await errorOf(cancelBooking(db, f.actors.manager, bookingId, { reason: "Buyer withdrew" }));
      expect(blocked?.code).toBe("BUSINESS_RULE");
      expect(blocked?.details).toMatchObject({ paid: 500_000 });

      const { requestId } = await requestReversal(db, accountant, paymentId, { reason: "Recorded on the wrong booking" });
      await decideReversal(db, f.actors.manager, requestId, { approve: true });
      expect(await errorCode(cancelBooking(db, f.actors.manager, bookingId, { reason: "Buyer withdrew" }))).toBe("ok");
    });

    it("limits itemised history to finance roles and the team's manager; applies the configured prefixes", async () => {
      const bookingId = await bookingAt();
      const { receiptNo } = await pay(bookingId, "1000");
      expect(await bookingPaymentHistory(db, f.actors.agent1, bookingId)).toBeNull();
      expect(await bookingPaymentHistory(db, f.actors.manager, bookingId)).toHaveLength(1);
      expect(await errorCode(listPayments(db, f.actors.manager, {}))).toBe("FORBIDDEN");

      expect(await errorCode(updateFinanceSettings(db, accountant, { receipt_prefix: "X-" }))).toBe("FORBIDDEN");
      expect(await errorCode(updateFinanceSettings(db, f.actors.superAdmin, { receipt_prefix: "<bad>" }))).toBe("VALIDATION_FAILED");
      await updateFinanceSettings(db, f.actors.superAdmin, { receipt_prefix: "RCPT-" });
      expect((await listPayments(db, admin, { bookingId })).rows[0].displayRef).toBe(`RCPT-${receiptNo}`);
      expect((await errorOf(addPaymentMethod(db, f.actors.superAdmin, { name: "Cash" })))?.fields).toHaveProperty("name");
    });
  });

  describe("F2 screens' queries", () => {
    it("searches and filters the payments list and marks reversed payments", async () => {
      const a = await bookingAt();
      const b = await bookingAt();
      const first = await pay(a, "1000", { reference: "CHQ-778899" });
      await pay(b, "2000", { type: "down_payment" });
      const { requestId } = await requestReversal(db, accountant, first.paymentId, { reason: "Cheque bounced at the bank" });
      await decideReversal(db, admin, requestId, { approve: true });

      const list = async (q: Record<string, string>) => (await listPayments(db, accountant, q)).rows;
      expect((await list({})).map((r) => r.kind)).toEqual(["reversal", "payment", "payment"]);
      expect((await list({ kind: "payment" })).find((r) => r.id === first.paymentId)?.reversed).toBe(true);
      expect((await list({ q: "CHQ-778" })).map((r) => r.id)).toEqual([first.paymentId]);
      expect((await list({ q: String(first.receiptNo) })).some((r) => r.id === first.paymentId)).toBe(true);
      expect((await list({ type: "down_payment" })).map((r) => r.amount)).toEqual([2000]);
      expect(await list({ from: "2099-01-01" })).toEqual([]);
      expect((await listPayments(db, accountant, { project: f.otherProjectId })).total).toBe(0);
    });

    it("shows a payment's detail, reversal state and audit trail only within the viewer's reach", async () => {
      const bookingId = await bookingAt();
      const { paymentId } = await pay(bookingId, "1000");
      const before = await getPaymentDetail(db, accountant, paymentId);
      expect(before.permissions).toEqual({ requestReversal: true, decide: false });
      const { requestId } = await requestReversal(db, accountant, paymentId, { reason: "Recorded twice by mistake" });

      const forManager = await getPaymentDetail(db, f.actors.manager, paymentId);
      expect(forManager.permissions).toEqual({ requestReversal: false, decide: true });
      expect((await getPaymentDetail(db, accountant, paymentId)).permissions).toEqual({ requestReversal: false, decide: false });
      expect(await errorCode(getPaymentDetail(db, f.actors.agent1, paymentId))).toBe("FORBIDDEN");

      const decision = await decideReversal(db, f.actors.manager, requestId, { approve: true });
      const reversal = await getPaymentDetail(db, accountant, decision.reversalId!);
      expect(reversal.entry.kind).toBe("reversal");
      expect(reversal.original.id).toBe(paymentId);
      expect(reversal.trail.map((t) => t.action)).toEqual(["payment.reversal_approved", "payment.reversal_requested", "payment.record"]);

      const outside = await bookingAt(["token_pending"], f.actors.outsideAgent);
      const other = await pay(outside, "500");
      expect(await errorCode(getPaymentDetail(db, f.actors.manager, other.paymentId))).toBe("NOT_FOUND");
    });

    it("reconciles Outstanding totals with the rows and lists only bookings that can take a payment", async () => {
      const a = await bookingAt();
      const b = await bookingAt();
      await bookingAt([]); // Negotiation: listed in Outstanding, not payable
      await pay(a, "3750000"); // 30% of 12.5M
      await pay(b, "12500000"); // fully paid

      const out = await outstandingBookings(db, accountant, {});
      expect(out.rows).toHaveLength(3);
      const sum = (pick: (r: (typeof out.rows)[number]) => number) => out.rows.reduce((acc, r) => acc + pick(r), 0);
      expect(out.totals).toEqual({ total: sum((r) => r.totalSale), paid: sum((r) => r.paid), outstanding: sum((r) => r.outstanding), overdue: 0 });
      expect(out.rows.every((r) => r.overdue === null && r.dueToDate === null)).toBe(true); // no payment plans: no schedule
      expect(out.totals.paid).toBe(16_250_000);
      expect((await outstandingBookings(db, accountant, { milestone: "met" })).rows.map((r) => r.bookingId).sort()).toEqual([a, b].sort());
      expect(await errorCode(outstandingBookings(db, f.actors.manager, {}))).toBe("FORBIDDEN");

      const payable = (await payableBookings(db, accountant)).map((r) => r.id);
      expect(payable).toEqual([a]);
      expect(await errorCode(payableBookings(db, admin))).toBe("FORBIDDEN");
    });
  });

  describe("list filters (FINANCE_MODULE_PLAN §4)", () => {
    it("Payments filter by method; a reversal follows the method of the payment it reverses", async () => {
      const chequeId = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cheque")!.id;
      const a = await bookingAt();
      const cash = await pay(a, "1000");
      const cheque = await pay(a, "2000", { methodId: chequeId, reference: "CHQ-1" });
      const { requestId } = await requestReversal(db, accountant, cheque.paymentId, { reason: "Cheque bounced at the bank" });
      const { reversalId } = await decideReversal(db, f.actors.manager, requestId, { approve: true });

      const ids = async (method: string) => (await listPayments(db, accountant, { method })).rows.map((r) => r.id).sort();
      expect(await ids(cashId)).toEqual([cash.paymentId]);
      expect(await ids(chequeId)).toEqual([cheque.paymentId, reversalId!].sort());
      expect((await listPayments(db, accountant, { method: chequeId, kind: "reversal" })).rows.map((r) => r.id)).toEqual([reversalId]);
      // An unknown or malformed method is ignored rather than failing the page.
      expect((await listPayments(db, accountant, { method: "not-a-uuid" })).total).toBe(3);
    });

    it("Bookings list sorts by paid (net of reversals), unit and lead, both directions (FR-005)", async () => {
      const a = await bookingAt();
      const b = await bookingAt();
      const c = await bookingAt();
      await pay(a, "300000");
      const { paymentId } = await pay(b, "900000");
      await pay(c, "600000");
      // Reversing b's payment drops it to 0 paid: sorting uses the same net the column shows.
      const { requestId } = await requestReversal(db, accountant, paymentId, { reason: "Entered against the wrong booking" });
      await decideReversal(db, f.actors.manager, requestId, { approve: true });

      const order = async (q: Record<string, string>) => (await listBookings(db, f.actors.superAdmin, q, f.projectId, TODAY)).rows.map((r) => r.id);
      expect(await order({ sort: "paid", dir: "asc" })).toEqual([b, a, c]);
      expect(await order({ sort: "paid", dir: "desc" })).toEqual([c, a, b]);
      const rows = (await listBookings(db, f.actors.superAdmin, { sort: "unit", dir: "asc" }, f.projectId, TODAY)).rows.map((r) => r.unitNo.toLowerCase());
      expect(rows).toEqual([...rows].sort());
      // Default: most recently changed first; unknown sort values fall back to it.
      expect(await order({ sort: "bogus" })).toEqual(await order({}));
      expect((await listBookings(db, f.actors.superAdmin, { sort: "bogus" }, f.projectId, TODAY)).query).toMatchObject({ sort: "updatedAt", dir: "desc" });
    });

    it("Outstanding filters by sales agent and lists the agents that have bookings", async () => {
      const mine = await bookingAt();
      const theirs = await bookingAt(["token_pending"], f.actors.outsideAgent);
      const all = await outstandingBookings(db, accountant, {}, TODAY);
      expect(all.agents.map((x) => x.id).sort()).toEqual([f.actors.agent1.id, f.actors.outsideAgent.id].sort());
      expect((await outstandingBookings(db, accountant, { agent: f.actors.outsideAgent.id }, TODAY)).rows.map((r) => r.bookingId)).toEqual([theirs]);
      const filtered = await outstandingBookings(db, accountant, { agent: f.actors.agent1.id }, TODAY);
      expect(filtered.rows.map((r) => r.bookingId)).toEqual([mine]);
      expect(filtered.totals.total).toBe(12_500_000);
    });
  });

  describe("overdue against the payment plan (FR-203)", () => {
    const plan = async (bookingId: string, rows: { amount: number; dueOn: string | null }[], status: "open" | "cancelled" = "open") => {
      const [t] = await db
        .insert(tasks)
        .values({ title: "Plan", type: "payment_plan", status, assigneeId: f.actors.agent1.id, bookingId, proposal: {} as never })
        .returning({ id: tasks.id });
      await db.insert(taskInstallmentRows).values(rows.map((r, i) => ({ taskId: t.id, seq: i + 1, label: `Row ${i + 1}`, amount: r.amount, dueOn: r.dueOn })));
      return t.id;
    };

    it("compares installments due by today with net paid; undated rows and bookings without a plan are not guessed", async () => {
      const a = await bookingAt();
      const b = await bookingAt();
      const none = await bookingAt();
      // a: 2 past-due installments (2,000,000), one future, one undated down payment.
      const planA = await plan(a, [
        { amount: 3_000_000, dueOn: null },
        { amount: 1_000_000, dueOn: "2026-01-10" },
        { amount: 1_000_000, dueOn: "2026-02-10" },
        { amount: 1_000_000, dueOn: "2099-01-10" },
      ]);
      await pay(a, "1500000");
      // b: a cancelled plan is ignored; the open one is fully covered by payments.
      await plan(b, [{ amount: 9_000_000, dueOn: "2026-01-10" }], "cancelled");
      await plan(b, [{ amount: 500_000, dueOn: "2026-01-10" }]);
      await pay(b, "800000");

      const out = await outstandingBookings(db, accountant, {});
      const row = (id: string) => out.rows.find((r) => r.bookingId === id)!;
      expect(row(a)).toMatchObject({ planTaskId: planA, dueToDate: 2_000_000, undatedRows: 1, overdue: 500_000 });
      expect(row(b)).toMatchObject({ dueToDate: 500_000, undatedRows: 0, overdue: 0 });
      expect(row(none)).toMatchObject({ planTaskId: null, dueToDate: null, overdue: null });
      expect(out.totals.overdue).toBe(500_000);
      expect((await outstandingBookings(db, accountant, { overdue: "yes" })).rows.map((r) => r.bookingId)).toEqual([a]);
    });


    it("a reversed payment no longer counts: the booking becomes overdue again", async () => {
      const a = await bookingAt();
      await plan(a, [
        { amount: 1_000_000, dueOn: "2026-01-10" },
        { amount: 1_000_000, dueOn: "2026-02-10" },
      ]);
      await pay(a, "1000000");
      const { paymentId } = await pay(a, "1000000");
      expect((await outstandingBookings(db, accountant, {}, TODAY)).rows[0]).toMatchObject({ paid: 2_000_000, dueToDate: 2_000_000, overdue: 0 });

      const { requestId } = await requestReversal(db, accountant, paymentId, { reason: "Cheque bounced at the bank" });
      // Requested but not decided: still counted.
      expect((await outstandingBookings(db, accountant, {}, TODAY)).rows[0].overdue).toBe(0);
      await decideReversal(db, f.actors.manager, requestId, { approve: true });
      expect((await outstandingBookings(db, accountant, {}, TODAY)).rows[0]).toMatchObject({ paid: 1_000_000, overdue: 1_000_000 });
    });

    it("partial payments reduce the overdue amount; overpaying the schedule never goes below zero", async () => {
      const a = await bookingAt();
      await plan(a, [
        { amount: 1_000_000, dueOn: "2026-01-10" },
        { amount: 1_000_000, dueOn: "2026-02-10" },
        { amount: 1_000_000, dueOn: "2026-03-10" },
      ]);
      const overdue = async () => (await outstandingBookings(db, accountant, {}, TODAY)).rows[0].overdue;
      expect(await overdue()).toBe(3_000_000);
      await pay(a, "250000.50");
      expect(await overdue()).toBe(2_749_999.5);
      await pay(a, "2749999.50");
      expect(await overdue()).toBe(0);
      await pay(a, "5000000");
      expect(await overdue()).toBe(0);
    });

    it("an installment counts from its due date in Pakistan, not UTC", async () => {
      const a = await bookingAt();
      await plan(a, [{ amount: 700_000, dueOn: "2026-11-10" }]);
      // 2026-11-09 19:00 UTC is already the 10th in Pakistan (UTC+5); 18:59 UTC is still the 9th.
      expect(businessToday(new Date("2026-11-09T18:59:59Z"))).toBe("2026-11-09");
      expect(businessToday(new Date("2026-11-09T19:00:00Z"))).toBe("2026-11-10");
      const dueOn = async (today: string) => (await scheduleDueByBooking(db, [a], today)).get(a)!.dueToDate;
      expect(await dueOn("2026-11-09")).toBe(0);
      expect(await dueOn("2026-11-10")).toBe(700_000);
      expect((await outstandingBookings(db, accountant, {}, businessToday(new Date("2026-11-09T18:59:59Z")))).rows[0].overdue).toBe(0);
      expect((await outstandingBookings(db, accountant, {}, businessToday(new Date("2026-11-09T19:00:00Z")))).rows[0].overdue).toBe(700_000);
    });

    it("the most recent open plan is the schedule when a booking has several", async () => {
      const a = await bookingAt();
      await plan(a, [{ amount: 100, dueOn: "2026-01-10" }]);
      await new Promise((r) => setTimeout(r, 5));
      const latest = await plan(a, [{ amount: 900, dueOn: "2026-01-10" }]);
      expect((await outstandingBookings(db, accountant, {}, TODAY)).rows[0]).toMatchObject({ planTaskId: latest, dueToDate: 900 });
    });

    it("totals equal the sums of the rows, and Paid equals the posted payment records", async () => {
      const a = await bookingAt();
      const b = await bookingAt();
      await bookingAt();
      await plan(a, [{ amount: 2_000_000, dueOn: "2026-01-10" }]);
      await plan(b, [
        { amount: 1_000_000, dueOn: "2026-01-10" },
        { amount: 1_000_000, dueOn: null },
      ]);
      await pay(a, "1234567.89");
      const { paymentId } = await pay(b, "300000");
      await pay(b, "50000.25");
      const { requestId } = await requestReversal(db, accountant, paymentId, { reason: "Duplicate entry recorded" });
      await decideReversal(db, f.actors.manager, requestId, { approve: true });

      const out = await outstandingBookings(db, accountant, {}, TODAY);
      const cents = (n: number) => Math.round(n * 100);
      const sum = (pick: (r: (typeof out.rows)[number]) => number) => out.rows.reduce((acc, r) => acc + cents(pick(r)), 0) / 100;
      expect(out.totals).toEqual({ total: sum((r) => r.totalSale), paid: sum((r) => r.paid), outstanding: sum((r) => r.outstanding), overdue: sum((r) => r.overdue ?? 0) });

      // Paid per booking against the ledger rows themselves (a reversal is a positive amount of kind "reversal").
      const ledger = await db.select({ bookingId: bookingPayments.bookingId, amount: bookingPayments.amount, kind: bookingPayments.kind }).from(bookingPayments);
      for (const r of out.rows) {
        const posted = ledger.filter((l) => l.bookingId === r.bookingId).reduce((acc, l) => acc + cents(Number(l.amount)) * (l.kind === "reversal" ? -1 : 1), 0) / 100;
        expect(r.paid, r.bookingId).toBe(posted);
      }
      expect(out.rows.find((r) => r.bookingId === a)!.overdue).toBe(765_432.11);
      expect(out.rows.find((r) => r.bookingId === b)).toMatchObject({ paid: 50_000.25, dueToDate: 1_000_000, undatedRows: 1, overdue: 949_999.75 });
      expect(out.totals.overdue).toBe(1_715_431.86);
    });
  });
});
