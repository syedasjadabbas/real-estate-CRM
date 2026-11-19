import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, cancelBooking, createBooking } from "@/modules/bookings/commands";
import { getBookingDetail } from "@/modules/bookings/queries";
import { decideReversal, recordPayment, requestReversal } from "@/modules/finance/commands";
import { addCategory, createEntry, listCategories } from "@/modules/finance/entries";
import { listPaymentMethods } from "@/modules/finance/queries";
import { recordRefund, refundsDue } from "@/modules/finance/refunds";
import { collectionsByProject, commissionReport, dailyCollections, exportReport, refundsAndReversals } from "@/modules/finance/reports";
import { addWorkingDays, pendingTransfers, recordTransfer, transferHistory, workingDaysBetween } from "@/modules/finance/transfers";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { hashPassword } from "@/server/auth/password";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, developerTransferReceipts, holidays, users } from "@/server/db/schema";
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
const DAY = "2026-11-02"; // a Monday

describe("working days", () => {
  const weekend = [0]; // Sunday off
  it("skips the weekly day off and holidays", () => {
    // Mon 2 Nov + 10 working days (Sundays 8 and 15 skipped) = Fri 13 Nov.
    expect(addWorkingDays("2026-11-02", 10, weekend, new Set())).toBe("2026-11-13");
    expect(addWorkingDays("2026-11-02", 10, weekend, new Set(["2026-11-09"]))).toBe("2026-11-14");
    expect(addWorkingDays("2026-11-02", 10, [0, 6], new Set())).toBe("2026-11-16");
  });
  it("counts working days between two dates, negative when late", () => {
    expect(workingDaysBetween("2026-11-02", "2026-11-04", weekend, new Set())).toBe(2);
    expect(workingDaysBetween("2026-11-09", "2026-11-07", weekend, new Set())).toBe(-1);
    expect(workingDaysBetween("2026-11-04", "2026-11-04", weekend, new Set())).toBe(0);
  });
});

describe.skipIf(!hasTestDb)("Finance: refunds, Closed Won rule, developer transfers, reports (PostgreSQL)", () => {
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
    cashId = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash")!.id;
  });

  /** 500 sq ft × 25,000 = 12,500,000. */
  const booking = async (stages: string[] = []) => {
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: `U-${Math.random().toString(36).slice(2, 8)}`, areaSqft: "500", basePrice: "1" });
    const lead = await createLead(db, f.actors.agent1, leadInput(f));
    if (lead.outcome !== "created") throw new Error("setup");
    const { bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: lead.leadId, unitId, ratePerSqft: "25000", tokenAmount: "500000" });
    for (const s of stages) await advanceBooking(db, f.actors.superAdmin, bookingId, { toStage: s });
    return bookingId;
  };
  const pay = (bookingId: string, amount: string, receivedOn = DAY) => recordPayment(db, accountant, { bookingId, type: "token", amount, receivedOn, methodId: cashId });

  it("cancelling a paid booking needs the deduction and sets the refund due", async () => {
    const id = await booking();
    await pay(id, "500000");
    expect((await errorOf(cancelBooking(db, admin, id, { reason: "Buyer withdrew" })))?.fields).toHaveProperty("deduction");
    expect((await errorOf(cancelBooking(db, admin, id, { reason: "Buyer withdrew", deduction: "500001" })))?.fields).toHaveProperty("deduction");
    const res = await cancelBooking(db, admin, id, { reason: "Buyer withdrew", deduction: "100,000" });
    expect(res.refundDue).toBe(400_000);
    const due = await refundsDue(db, accountant);
    expect(due.find((r) => r.bookingId === id)).toMatchObject({ deduction: 100_000, due: 400_000, refunded: 0, remaining: 400_000 });
  });

  it("records refunds up to the amount due; they lower net paid and show in reports", async () => {
    const id = await booking();
    await pay(id, "500000");
    await cancelBooking(db, admin, id, { reason: "Buyer withdrew", deduction: "100000" });
    const input = { amount: "150000", paidOn: DAY, methodId: cashId, reference: "CHQ-1" };
    expect((await errorOf(recordRefund(db, admin, id, input)))?.code).toBe("FORBIDDEN");
    const first = await recordRefund(db, accountant, id, input);
    expect(first.ref).toMatch(/^RF-\d+$/);
    expect(first.remaining).toBe(250_000);
    expect((await errorOf(recordRefund(db, accountant, id, { ...input, amount: "250000.01" })))?.fields).toHaveProperty("amount");
    await recordRefund(db, accountant, id, { ...input, amount: "250000" });
    expect((await errorOf(recordRefund(db, accountant, id, { ...input, amount: "1" })))?.code).toBe("BUSINESS_RULE");
    expect((await refundsDue(db, accountant)).find((r) => r.bookingId === id)).toBeUndefined();
    expect((await getBookingDetail(db, f.actors.superAdmin, id, DAY)).money.paid).toBe(100_000);

    const range = { from: DAY, to: DAY };
    const c = await collectionsByProject(db, accountant, range);
    expect(c.totals).toMatchObject({ received: 500_000, reversed: 0, refunded: 400_000, net: 100_000, refunds: 2 });
    const rr = await refundsAndReversals(db, accountant, range);
    expect(rr.totals).toMatchObject({ refunds: 2, refunded: 400_000, reversals: 0 });
    expect(rr.rows[0].kindLabel).toBe("Refund");
    const daily = await dailyCollections(db, accountant, range);
    expect(daily.totals).toEqual({ received: 500_000, returned: 400_000, net: 100_000 });
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, "payment.refund")));
    expect(audit.after).toMatchObject({ amount: 150_000 });
  });

  it("refuses refunds on bookings that are not cancelled with a refund due", async () => {
    const id = await booking();
    await pay(id, "500000");
    expect((await errorOf(recordRefund(db, accountant, id, { amount: "1", paidOn: DAY, methodId: cashId })))?.code).toBe("BUSINESS_RULE");
  });

  it("allows Closed Won only once the down payment is posted", async () => {
    const id = await booking(["down_payment", "agreement_pending"]);
    const err = await errorOf(advanceBooking(db, f.actors.superAdmin, id, { toStage: "confirmed" }));
    expect(err?.code).toBe("BUSINESS_RULE");
    expect(err?.message).toMatch(/down payment/i);
    const required = (err?.details as { required: number }).required;
    await pay(id, String(required));
    await advanceBooking(db, f.actors.superAdmin, id, { toStage: "confirmed" });
  });

  it("tracks receipts due to the developer and records transfers on time or late", async () => {
    const id = await booking();
    await db.insert(holidays).values({ name: "Test holiday", date: "2026-11-04", scope: "company" }).onConflictDoNothing();
    const a = await pay(id, "100000", "2026-11-02");
    const b = await pay(id, "200000", "2026-11-03");
    const c = await pay(id, "300000", "2026-11-03");
    // c is reversed: no longer held.
    const { requestId } = await requestReversal(db, accountant, c.paymentId, { reason: "Wrong booking" });
    await decideReversal(db, admin, requestId, { approve: true, note: "ok" });

    const pending = await pendingTransfers(db, accountant, "2026-11-10");
    expect(pending.rows.map((r) => r.id).sort()).toEqual([a.paymentId, b.paymentId].sort());
    const ra = pending.rows.find((r) => r.id === a.paymentId)!;
    expect(ra.dueOn > "2026-11-12").toBe(true); // the holiday pushes it a day later
    expect(pending.totals.amount).toBe(300_000);

    expect((await errorOf(recordTransfer(db, accountant, { transferredOn: "2026-11-02", paymentIds: [a.paymentId, b.paymentId] })))?.fields).toHaveProperty("transferredOn");
    expect((await errorOf(recordTransfer(db, admin, { transferredOn: "2026-11-05", paymentIds: [a.paymentId] })))?.code).toBe("FORBIDDEN");
    expect((await errorOf(recordTransfer(db, accountant, { transferredOn: "2026-11-05", paymentIds: [c.paymentId] })))?.code).toBe("CONFLICT");

    const t1 = await recordTransfer(db, accountant, { transferredOn: "2026-11-05", reference: "IBFT-1", paymentIds: [a.paymentId] });
    expect(t1).toMatchObject({ amount: 100_000, receipts: 1 });
    expect((await errorOf(recordTransfer(db, accountant, { transferredOn: "2026-11-06", paymentIds: [a.paymentId] })))?.code).toBe("CONFLICT");
    await recordTransfer(db, accountant, { transferredOn: "2026-11-18", paymentIds: [b.paymentId] });

    const history = await transferHistory(db, accountant);
    expect(history.map((h) => ({ amount: h.amount, onTime: h.onTime }))).toEqual([
      { amount: 200_000, onTime: false },
      { amount: 100_000, onTime: true },
    ]);
    expect((await pendingTransfers(db, accountant, "2026-11-19")).rows).toHaveLength(0);
    const [row] = await db.select().from(developerTransferReceipts).where(eq(developerTransferReceipts.paymentId, a.paymentId));
    expect(row.transferId).toBe(t1.transferId);
  });

  it("builds the commission report from recorded entries and exports every report", async () => {
    // Categories are truncated between tests; the migration seeds these names in real databases.
    await addCategory(db, f.actors.superAdmin, { kind: "income", name: "Commission" });
    await addCategory(db, f.actors.superAdmin, { kind: "expense", name: "Agent commissions" });
    const cats = await listCategories(db);
    const commission = cats.find((c) => c.kind === "income" && c.name === "Commission")!;
    const agentComm = cats.find((c) => c.kind === "expense" && c.name === "Agent commissions")!;
    await createEntry(db, accountant, { kind: "income", categoryId: commission.id, amount: "900000", entryDate: "2026-11-03", methodId: cashId });
    await createEntry(db, accountant, { kind: "expense", categoryId: agentComm.id, amount: "120000", entryDate: "2026-11-04", methodId: cashId, payee: "Agent One" });
    await createEntry(db, accountant, { kind: "expense", categoryId: agentComm.id, amount: "80000", entryDate: "2026-10-04", methodId: cashId, payee: "Agent One" });
    const r = await commissionReport(db, accountant, { year: 2026 });
    expect(r.totals).toEqual({ received: 900_000, paid: 200_000, net: 700_000 });
    expect(r.months[10]).toMatchObject({ month: "2026-11", received: 900_000, paid: 120_000 });
    expect(r.payees).toEqual([{ payee: "Agent One", entries: 2, paid: 200_000 }]);

    for (const report of ["daily_collections", "refunds_reversals", "commissions", "collections"]) {
      const out = await exportReport(db, accountant, { report, from: DAY, to: DAY, year: "2026" });
      expect(out.body.split("\n")[0].length).toBeGreaterThan(10);
    }
    expect((await errorOf(commissionReport(db, f.actors.agent1, {})))?.code).toBe("FORBIDDEN");
  });
});
