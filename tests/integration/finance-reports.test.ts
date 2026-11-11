import { eq } from "drizzle-orm";
import { businessToday } from "@/modules/bookings/today";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, createBooking } from "@/modules/bookings/commands";
import { decideReversal, recordPayment, requestReversal } from "@/modules/finance/commands";
import { listPaymentMethods } from "@/modules/finance/queries";
import { collectionsByProject, exportReport, outstandingBy, reportRange } from "@/modules/finance/reports";
import { listOutstanding, outstandingBookings } from "@/modules/finance/views";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, bookingPayments, bookings, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor, Role } from "@/server/auth/types";
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

describe.skipIf(!hasTestDb)("Finance reports FR-205 (PostgreSQL integration)", () => {
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
    accountant = await make("Accountant", "acc@test.local", "accountant");
    admin = await make("Admin", "admin@test.local", "admin");
    cashId = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash")!.id;
  });

  const make = async (name: string, email: string, role: Role) => {
    const [u] = await db.insert(users).values({ name, email, role, passwordHash: "x" }).returning();
    return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  };

  /** Booking of 500 sq ft × 25,000 = 12,500,000 in `projectId`, owned by `owner`, at Token pending. */
  const booking = async (projectId: string, owner: Actor = f.actors.agent1) => {
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId, unitNo: `U-${Math.random().toString(36).slice(2, 8)}`, areaSqft: "500", basePrice: "1" });
    const lead = await createLead(db, owner, leadInput(f, { projectId }));
    if (lead.outcome !== "created") throw new Error("setup");
    const { bookingId } = await createBooking(db, owner, { projectId, leadId: lead.leadId, unitId, ratePerSqft: "25000", tokenAmount: "500000" });
    await advanceBooking(db, f.actors.superAdmin, bookingId, { toStage: "token_pending" });
    return bookingId;
  };
  const pay = (bookingId: string, amount: string, receivedOn: string) => recordPayment(db, accountant, { bookingId, type: "token", amount, receivedOn, methodId: cashId });

  describe("F-23: outstanding by agent groups by the person, not the name", () => {
    /** Two different agents with the exact same name: the first has two bookings, the second one. */
    const twins = async () => {
      const a = await make("Ali Khan", "ali1@test.local", "agent");
      const b = await make("Ali Khan", "ali2@test.local", "agent");
      const first = await booking(f.projectId);
      const second = await booking(f.projectId);
      const third = await booking(f.projectId);
      await db.update(bookings).set({ agentId: a.id }).where(eq(bookings.id, first));
      await db.update(bookings).set({ agentId: a.id }).where(eq(bookings.id, second));
      await db.update(bookings).set({ agentId: b.id }).where(eq(bookings.id, third));
      await pay(first, "2500000", "2026-10-05");
      await pay(third, "1000000", "2026-10-06");
      return { a, b, third };
    };

    it("keeps each agent's figures apart, under the same displayed name, with correct totals", async () => {
      const { a, b } = await twins();
      const report = await outstandingBy(db, accountant, "agent");
      expect(report.rows.map((r) => [r.key, r.label, r.bookings, r.total, r.paid, r.outstanding])).toEqual([
        [a.id, "Ali Khan", 2, 25_000_000, 2_500_000, 22_500_000],
        [b.id, "Ali Khan", 1, 12_500_000, 1_000_000, 11_500_000],
      ]);
      const screen = await outstandingBookings(db, accountant, {});
      expect(report.totals).toMatchObject({ total: 37_500_000, paid: 3_500_000, outstanding: 34_000_000, bookings: 3 });
      expect(report.totals).toMatchObject({ total: screen.totals.total, paid: screen.totals.paid, outstanding: screen.totals.outstanding });
      const sum = (k: "total" | "paid" | "outstanding") => report.rows.reduce((n, r) => n + r[k], 0);
      expect([sum("total"), sum("paid"), sum("outstanding")]).toEqual([37_500_000, 3_500_000, 34_000_000]);
      // The project view of the same bookings isn't split.
      expect((await outstandingBy(db, accountant, "project")).rows).toEqual([expect.objectContaining({ label: "Test Project", bookings: 3, outstanding: 34_000_000 })]);
    });

    it("the CSV has one row per agent, and its total is unchanged", async () => {
      await twins();
      const { body } = await exportReport(db, accountant, { report: "outstanding_agent" });
      const lines = body.trim().split("\n");
      expect(lines.filter((l) => l.startsWith("Ali Khan,"))).toHaveLength(2);
      expect(lines.at(-1)).toMatch(/^Total,.*,3,37500000,3500000,34000000/);
    });

    it("the agent filter separates them too, on the report rows and the screen", async () => {
      const { a, b } = await twins();
      for (const [agent, n] of [[a.id, 2], [b.id, 1]] as const) {
        expect((await outstandingBookings(db, accountant, { agent })).rows).toHaveLength(n);
        expect((await listOutstanding(db, accountant, { agent })).total).toBe(n);
      }
      expect((await outstandingBookings(db, accountant, {})).agents.filter((x) => x.name === "Ali Khan").map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    });

    it("a reversal moves only that agent's figures; bookings with no agent stay in one row", async () => {
      const { a, b, third } = await twins();
      const [payment] = await db.select().from(bookingPayments).where(eq(bookingPayments.bookingId, third));
      const { requestId } = await requestReversal(db, accountant, payment.id, { reason: "Entered twice by mistake" });
      await decideReversal(db, admin, requestId, { approve: true });
      const rows = (await outstandingBy(db, accountant, "agent")).rows;
      expect(rows.find((r) => r.key === b.id)).toMatchObject({ paid: 0, outstanding: 12_500_000 });
      expect(rows.find((r) => r.key === a.id)).toMatchObject({ paid: 2_500_000, outstanding: 22_500_000 });

      await db.update(bookings).set({ agentId: null });
      expect((await outstandingBy(db, accountant, "agent")).rows).toEqual([expect.objectContaining({ key: "none", label: "No agent", bookings: 3 })]);
    });

    it("equal figures keep one order", async () => {
      const a = await make("Ali Khan", "ali1@test.local", "agent");
      const b = await make("Ali Khan", "ali2@test.local", "agent");
      const first = await booking(f.projectId);
      const second = await booking(f.projectId);
      await db.update(bookings).set({ agentId: a.id }).where(eq(bookings.id, first));
      await db.update(bookings).set({ agentId: b.id }).where(eq(bookings.id, second));
      expect((await outstandingBy(db, accountant, "agent")).rows.map((r) => r.key)).toEqual([a.id, b.id].sort());
    });
  });

  it("reconciles collections with the ledger rows in the range, reversals subtracting", async () => {
    const b1 = await booking(f.projectId);
    const b2 = await booking(f.otherProjectId, f.actors.outsideAgent);
    await pay(b1, "500000", "2026-10-05");
    const { paymentId } = await pay(b1, "100000", "2026-10-06");
    await pay(b2, "250000", "2026-10-07");
    await pay(b2, "999", "2026-09-30"); // outside the range
    const { requestId } = await requestReversal(db, accountant, paymentId, { reason: "Entered twice by mistake" });
    await decideReversal(db, admin, requestId, { approve: true });
    const [reversal] = await db.select().from(bookingPayments).where(eq(bookingPayments.reversalOfId, paymentId));
    // Client rule (10 Nov 2026): a reversal counts in the period it is processed, not the original payment's.
    expect(reversal.receivedOn).toBe(businessToday());

    const r = await collectionsByProject(db, accountant, { from: "2026-10-01", to: reversal.receivedOn > "2026-10-31" ? reversal.receivedOn : "2026-10-31" });
    const test = r.rows.find((x) => x.project === "Test Project")!;
    expect(test).toMatchObject({ receipts: 2, received: 600_000, reversals: 1, reversed: 100_000, net: 500_000 });
    expect(r.rows.find((x) => x.project === "Other Project")).toMatchObject({ receipts: 1, received: 250_000, reversed: 0, net: 250_000 });
    expect(r.totals).toMatchObject({ received: 850_000, reversed: 100_000, net: 750_000, receipts: 3, reversals: 1 });
    // Totals equal the sum of their rows.
    expect(r.rows.reduce((n, x) => n + x.net, 0)).toBe(r.totals.net);
  });

  it("groups outstanding by project and by agent, matching the Outstanding screen exactly", async () => {
    const b1 = await booking(f.projectId);
    await booking(f.projectId, f.actors.agent2);
    const b3 = await booking(f.otherProjectId, f.actors.outsideAgent);
    await pay(b1, "2500000", "2026-10-05");
    await pay(b3, "1000000", "2026-10-06");
    const screen = await outstandingBookings(db, accountant, {});
    const byProject = await outstandingBy(db, accountant, "project");
    const byAgent = await outstandingBy(db, accountant, "agent");
    expect(byProject.totals).toMatchObject({ total: screen.totals.total, paid: screen.totals.paid, outstanding: screen.totals.outstanding, bookings: 3 });
    expect(byProject.rows.map((r) => [r.label, r.bookings, r.outstanding])).toEqual([
      ["Test Project", 2, 22_500_000],
      ["Other Project", 1, 11_500_000],
    ]);
    expect(byAgent.rows.map((r) => [r.label, r.outstanding])).toEqual([
      ["Agent B", 12_500_000],
      ["Agent Outside", 11_500_000],
      ["Agent A", 10_000_000],
    ]);
    expect(byAgent.rows.reduce((n, r) => n + r.outstanding, 0)).toBe(screen.totals.outstanding);
  });

  it("defaults to month to date and swaps a reversed range", () => {
    expect(reportRange({}, "2026-10-31")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(reportRange({ from: "2026-10-20", to: "2026-10-01" })).toEqual({ from: "2026-10-01", to: "2026-10-20" });
    expect(reportRange({ from: "bad" }, "2026-10-31")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("is limited to super admin, admin and accountant", async () => {
    for (const actor of [f.actors.superAdmin, admin, accountant]) {
      expect(await errorCode(collectionsByProject(db, actor))).toBe("ok");
      expect(await errorCode(outstandingBy(db, actor, "agent"))).toBe("ok");
      expect(await errorCode(exportReport(db, actor, { report: "collections" }))).toBe("ok");
    }
    for (const actor of [f.actors.manager, f.actors.agent1, f.actors.hr]) {
      expect(await errorCode(collectionsByProject(db, actor))).toBe("FORBIDDEN");
      expect(await errorCode(outstandingBy(db, actor, "project"))).toBe("FORBIDDEN");
      expect(await errorCode(exportReport(db, actor, { report: "outstanding_agent" }))).toBe("FORBIDDEN");
    }
  });

  it("exports CSV with totals, neutralises formula cells and audits each export", async () => {
    const b1 = await booking(f.projectId);
    await pay(b1, "500000", "2026-10-05");
    await db.update(users).set({ name: "=HYPERLINK(\"x\")" }).where(eq(users.id, f.actors.agent1.id));
    const col = await exportReport(db, accountant, { report: "collections", from: "2026-10-01", to: "2026-10-31" });
    expect(col.filename).toBe("collections-2026-10-01-to-2026-10-31.csv");
    expect(col.body.split("\n")[0]).toBe("Project,From,To,Receipts,Received (PKR),Reversals,Reversed (PKR),Net collected (PKR)");
    expect(col.body).toContain("Test Project,2026-10-01,2026-10-31,1,500000,0,0,500000");
    expect(col.body).toContain("Total,2026-10-01,2026-10-31,1,500000,0,0,500000");
    const agents = await exportReport(db, admin, { report: "outstanding_agent" });
    expect(agents.body).toContain(`"'=HYPERLINK(""x"")"`);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "finance.report_export"));
    expect(audits.map((a) => [a.entityId, a.actorId])).toEqual(
      expect.arrayContaining([
        ["collections", accountant.id],
        ["outstanding_agent", admin.id],
      ]),
    );
  });
});
