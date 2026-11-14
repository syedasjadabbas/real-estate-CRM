import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBooking, rejectBookingPayment } from "@/modules/bookings/commands";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { loadActor } from "@/server/auth/session-store";
import { bookings, notifications, units, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const failure = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as AppError);

/** Owner, 14 Nov 2026: a token of at least PKR 20,000; Accounts reject a booking whose payment isn't genuine. */
describe.skipIf(!hasTestDb)("Booking token and payment verification (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let accountant: Actor;
  let leadId: string;
  let unitId: string;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [u] = await db.insert(users).values({ name: "Accounts", email: "acc@test.local", role: "accountant", passwordHash: "x" }).returning();
    accountant = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    const lead = await createLead(db, f.actors.agent1, leadInput(f));
    if (lead.outcome !== "created") throw new Error("setup");
    leadId = lead.leadId;
    ({ unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "TK-1", areaSqft: "500", basePrice: "10000000" }));
  });

  const book = (token: string) => createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId, unitId, tokenAmount: token });

  it("refuses a token under PKR 20,000", async () => {
    const err = await failure(book("19999"));
    expect(err?.fields?.tokenAmount).toBe("The token must be at least PKR 20,000");
    expect((await book("20000")).bookingId).toBeTruthy();
  });

  it("Accounts reject a booking whose payment isn't genuine: cancelled, unit freed, agent told", async () => {
    const { bookingId } = await book("50000");
    expect((await failure(rejectBookingPayment(db, f.actors.agent1, bookingId, { reason: "Not mine to say" })))?.code).toBe("FORBIDDEN");
    await rejectBookingPayment(db, accountant, bookingId, { reason: "No transfer received in the bank" });
    const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(b.stage).toBe("cancelled");
    expect(b.cancelledReason).toBe("Payment rejected by Accounts: No transfer received in the bank");
    expect((await db.select().from(units).where(eq(units.id, unitId)))[0].status).toBe("available");
    const [n] = await db.select().from(notifications).where(eq(notifications.type, "booking_rejected"));
    expect(n).toMatchObject({ userId: f.actors.agent1.id, body: "No transfer received in the bank" });
    expect((await failure(rejectBookingPayment(db, accountant, bookingId, { reason: "Again" })))?.code).toBe("BUSINESS_RULE");
  });
});
