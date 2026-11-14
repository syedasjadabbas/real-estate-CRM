import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, createBooking, decideDiscount } from "@/modules/bookings/commands";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { bookings, notifications } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

/** Booking discounts (owner, 14 Nov 2026): agents up to 5%; above it an Admin or Super Admin decides; rejected stays at 5%. */
describe.skipIf(!hasTestDb)("Booking discount approval (PostgreSQL integration)", () => {
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

  // A 674.5 sq ft unit priced at PKR 13,500,000: its rate isn't a round number.
  const book = async (discountPct: string) => {
    const r = await createLead(db, f.actors.agent1, leadInput(f));
    if (r.outcome !== "created") throw new Error("setup");
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: `D-${Math.random().toString(36).slice(2, 7)}`, areaSqft: "674.5", basePrice: "13500000" });
    const out = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: r.leadId, unitId, tokenAmount: "100000", discountPct });
    const [b] = await db.select().from(bookings).where(eq(bookings.id, out.bookingId));
    return b;
  };

  it("0% is exactly the inventory price; up to 5% applies at once", async () => {
    expect((await book("0")).totalSale).toBe(13_500_000);
    const b = await book("5");
    expect(b).toMatchObject({ totalSale: 12_825_000, discountPct: 5, discountStatus: "none" });
  });

  it("above 5% is held at 5%, tells the approvers, blocks stage moves, and moves to the asked % when approved", async () => {
    const b = await book("8");
    expect(b).toMatchObject({ totalSale: 12_825_000, discountPct: 5, discountRequestedPct: 8, discountStatus: "pending" });
    expect((await db.select().from(notifications).where(eq(notifications.type, "discount_requested"))).some((n) => n.userId === f.actors.superAdmin.id)).toBe(true);
    expect(await codeOf(advanceBooking(db, f.actors.agent1, b.id, { toStage: "down_payment" }))).toBe("BUSINESS_RULE");
    expect(await codeOf(decideDiscount(db, f.actors.agent1, b.id, { approve: true }))).toBe("FORBIDDEN");

    await decideDiscount(db, f.actors.superAdmin, b.id, { approve: true });
    const [after] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(after).toMatchObject({ totalSale: 12_420_000, discountPct: 8, discountStatus: "approved" });
    expect((await db.select().from(notifications).where(eq(notifications.type, "discount_decided"))).map((n) => n.userId)).toEqual([f.actors.agent1.id]);
  });

  it("a rejection needs a reason and keeps the booking at 5%", async () => {
    const b = await book("12");
    expect(await codeOf(decideDiscount(db, f.actors.superAdmin, b.id, { approve: false }))).toBe("VALIDATION_FAILED");
    await decideDiscount(db, f.actors.superAdmin, b.id, { approve: false, note: "Too high for this floor" });
    const [after] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(after).toMatchObject({ totalSale: 12_825_000, discountPct: 5, discountStatus: "rejected", discountNote: "Too high for this floor" });
    expect(await codeOf(decideDiscount(db, f.actors.superAdmin, b.id, { approve: true }))).toBe("BUSINESS_RULE");
  });
});
