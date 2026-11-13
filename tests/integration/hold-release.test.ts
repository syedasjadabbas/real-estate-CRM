import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, createBooking } from "@/modules/bookings/commands";
import { HOLD_DAYS, HOLD_EXPIRED_REASON } from "@/modules/bookings/constants";
import { releaseExpiredHolds } from "@/modules/bookings/hold-release";
import { getBookingDetail, listBookings } from "@/modules/bookings/queries";
import { addDays, businessToday } from "@/modules/bookings/today";
import { recordPayment } from "@/modules/finance/commands";
import { listPaymentMethods } from "@/modules/finance/queries";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { hashPassword } from "@/server/auth/password";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, bookingStageHistory, bookings, leads, units, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

describe.skipIf(!hasTestDb)("FR-081 unit-hold expiry and release (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let accountant: Actor;
  let cashId: string;

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
    cashId = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash")!.id;
  });

  /** A booking for agent1's lead with the default hold, moved through `stages`. */
  const bookingAt = async (stages: string[] = [], extra: Record<string, unknown> = {}) => {
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: `H-${Math.random().toString(36).slice(2, 8)}`, areaSqft: "500", basePrice: "1" });
    const lead = await createLead(db, f.actors.agent1, leadInput(f));
    if (lead.outcome !== "created") throw new Error("setup");
    const { bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: lead.leadId, unitId, ratePerSqft: "25000", tokenAmount: "500000", ...extra });
    for (const s of stages.filter((x) => !["token_pending", "token_received", "provisional_receipt", "sales_order", "booking_form"].includes(x))) await advanceBooking(db, f.actors.superAdmin, bookingId, { toStage: s });
    return { bookingId, unitId, leadId: lead.leadId };
  };
  const bookingRow = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0];
  const unitStatus = async (id: string) => (await db.select().from(units).where(eq(units.id, id)))[0].status;
  /** The first day on which a hold "until" `reservedUntil` counts as expired. */
  const dayAfter = (reservedUntil: string | null) => addDays(reservedUntil!, 1);

  it(`defaults a new booking's hold to ${HOLD_DAYS} days after creation, and keeps a date the creator picks`, async () => {
    const before = businessToday();
    const { bookingId } = await bookingAt();
    const after = businessToday();
    expect([addDays(before, HOLD_DAYS), addDays(after, HOLD_DAYS)]).toContain((await bookingRow(bookingId)).reservedUntil);

    const picked = addDays(after, 30);
    const { bookingId: manual } = await bookingAt([], { reservedUntil: picked });
    expect((await bookingRow(manual)).reservedUntil).toBe(picked);
  });

  it("releases an expired, unpaid hold: booking cancelled, unit Available, history and audit written, lead left as is", async () => {
    const { bookingId, unitId, leadId } = await bookingAt(["token_pending"]);
    const { reservedUntil } = await bookingRow(bookingId);
    const today = dayAfter(reservedUntil);

    // Shown as expired (to be released) until the job runs.
    expect((await getBookingDetail(db, f.actors.superAdmin, bookingId, today)).holdState).toBe("expired");
    const listed = (await listBookings(db, f.actors.superAdmin, {}, f.projectId, today)).rows.find((r) => r.id === bookingId);
    expect(listed?.holdState).toBe("expired");

    const result = await releaseExpiredHolds(db, { today });
    expect(result).toMatchObject({ status: "completed", eligible: 1, released: 1, skipped: 0, failed: 0 });
    expect(result.bookings[0]).toMatchObject({ bookingId, result: "released", stage: "token_pending" });

    const b = await bookingRow(bookingId);
    expect(b).toMatchObject({ stage: "cancelled", cancelledReason: HOLD_EXPIRED_REASON });
    expect(b.cancelledAt).not.toBeNull();
    expect(await unitStatus(unitId)).toBe("available");
    expect((await db.select().from(leads).where(eq(leads.id, leadId)))[0].stage).toBe("booking_in_process");

    const history = await db.select().from(bookingStageHistory).where(eq(bookingStageHistory.bookingId, bookingId));
    expect(history.find((h) => h.toStage === "cancelled")).toMatchObject({ fromStage: "token_pending", actorId: null, note: HOLD_EXPIRED_REASON });
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, bookingId), eq(auditLogs.action, "booking.cancel")));
    expect(audit).toMatchObject({ actorId: null, ip: null, entity: "booking" });
    expect(audit.after).toMatchObject({ stage: "cancelled", reason: HOLD_EXPIRED_REASON, source: "hold_expiry" });
    const unitAudit = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, unitId), eq(auditLogs.action, "unit.status")));
    expect(unitAudit.find((a) => (a.after as { status: string }).status === "available")).toMatchObject({ actorId: null, ip: null });

    // A second run finds nothing: the job is safe to repeat.
    expect(await releaseExpiredHolds(db, { today })).toMatchObject({ eligible: 0, released: 0 });
    // The freed unit can be booked again.
    expect(await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId, unitId, ratePerSqft: "25000", tokenAmount: "500000" })).toHaveProperty("bookingId");
  });

  it("releases a hold at Token with no payment, from a booking created with the default stage", async () => {
    const { bookingId, unitId } = await bookingAt();
    const result = await releaseExpiredHolds(db, { today: dayAfter((await bookingRow(bookingId)).reservedUntil) });
    expect(result).toMatchObject({ released: 1 });
    expect(await unitStatus(unitId)).toBe("available");
  });

  it("does not release an expired hold that has a recorded payment", async () => {
    const { bookingId, unitId } = await bookingAt(["token_pending"]);
    await recordPayment(db, accountant, { bookingId, type: "token", amount: "500000", receivedOn: businessToday(), methodId: cashId });
    const today = dayAfter((await bookingRow(bookingId)).reservedUntil);
    expect((await getBookingDetail(db, f.actors.superAdmin, bookingId, today)).holdState).toBe("overdue");

    expect(await releaseExpiredHolds(db, { today })).toMatchObject({ eligible: 0, released: 0 });
    expect((await bookingRow(bookingId)).stage).toBe("token_pending");
    expect(await unitStatus(unitId)).toBe("reserved");
  });

  it("does not release a booking past the Token stage (Partial Down Payment)", async () => {
    const { bookingId, unitId } = await bookingAt(["down_payment"]);
    expect(await releaseExpiredHolds(db, { today: dayAfter((await bookingRow(bookingId)).reservedUntil) })).toMatchObject({ eligible: 0 });
    expect((await bookingRow(bookingId)).stage).toBe("down_payment");
    expect(await unitStatus(unitId)).toBe("reserved");
  });

  it("does not release a hold that has not expired yet (its last day included)", async () => {
    const { bookingId, unitId } = await bookingAt(["token_pending"]);
    const { reservedUntil } = await bookingRow(bookingId);
    expect((await getBookingDetail(db, f.actors.superAdmin, bookingId, reservedUntil!)).holdState).toBeNull();
    expect(await releaseExpiredHolds(db, { today: reservedUntil! })).toMatchObject({ status: "completed", eligible: 0, released: 0 });
    expect(await releaseExpiredHolds(db, { today: businessToday() })).toMatchObject({ eligible: 0 });
    expect((await bookingRow(bookingId)).stage).toBe("token_pending");
    expect(await unitStatus(unitId)).toBe("reserved");
  });

  it("dry run lists the expired hold and changes nothing", async () => {
    const { bookingId, unitId } = await bookingAt(["token_pending"]);
    const today = dayAfter((await bookingRow(bookingId)).reservedUntil);
    const before = await bookingRow(bookingId);
    const auditCount = (await db.select().from(auditLogs)).length;
    const historyCount = (await db.select().from(bookingStageHistory)).length;

    const result = await releaseExpiredHolds(db, { today, dryRun: true });
    expect(result).toMatchObject({ dryRun: true, status: "dry_run", eligible: 1, released: 0 });
    expect(result.bookings).toEqual([expect.objectContaining({ bookingId, result: "eligible" })]);

    expect(await bookingRow(bookingId)).toEqual(before);
    expect(await unitStatus(unitId)).toBe("reserved");
    expect((await db.select().from(auditLogs)).length).toBe(auditCount);
    expect((await db.select().from(bookingStageHistory)).length).toBe(historyCount);
  });
});
