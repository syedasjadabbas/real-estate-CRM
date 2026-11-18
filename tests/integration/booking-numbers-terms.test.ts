import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "@/modules/bookings/commands";
import { getBookingDetail, listBookings } from "@/modules/bookings/queries";
import { businessToday } from "@/modules/bookings/today";
import { paymentTerms } from "@/modules/finance/constants";
import { setNextBookingNumber, updateFinanceSettings } from "@/modules/finance/commands";
import { getFinanceSettings } from "@/modules/finance/queries";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import type { Database } from "@/server/db";
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

describe.skipIf(!hasTestDb)("Booking numbers and payment grace periods (owner, 18 Nov 2026)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let n = 0;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
  });

  const book = async () => {
    n += 1;
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: `N-${n}`, areaSqft: "500", basePrice: "1" });
    const lead = await createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: `0300-81${String(n).padStart(5, "0")}` }));
    if (lead.outcome !== "created") throw new Error("lead");
    const { bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: lead.leadId, unitId, ratePerSqft: "25000", tokenAmount: "500000" });
    return (await getBookingDetail(db, f.actors.superAdmin, bookingId, businessToday())).ref;
  };

  it("numbers bookings in order with the prefix, and the Super Admin sets the prefix and the next number", async () => {
    const first = await book();
    const second = await book();
    expect([first, second]).toEqual([expect.stringMatching(/^BK-\d{4}$/), expect.stringMatching(/^BK-\d{4}$/)]);
    expect(Number(second!.slice(3))).toBe(Number(first!.slice(3)) + 1);

    await updateFinanceSettings(db, f.actors.superAdmin, { booking_prefix: "MZ-" });
    const used = Number(second!.slice(3));
    // The next number can't reuse one already given.
    expect((await errorOf(setNextBookingNumber(db, f.actors.superAdmin, { next: used })))?.fields?.next).toMatch(/already exist/);
    await setNextBookingNumber(db, f.actors.superAdmin, { next: 500 });
    expect(await book()).toBe("MZ-0500");

    // Search finds it by number; the list shows the number.
    const found = await listBookings(db, f.actors.superAdmin, { q: "MZ-0500", project: "all" }, null, businessToday());
    expect(found.rows.map((r) => r.ref)).toEqual(["MZ-0500"]);
    // Only a Super Admin changes numbering.
    expect((await errorOf(setNextBookingNumber(db, f.actors.agent1, { next: 900 })))?.code).toBe("FORBIDDEN");
  });

  it("grace periods default to 5 / 7 / 3 days and follow what the Super Admin saves", async () => {
    expect(paymentTerms(await getFinanceSettings(db))).toEqual({ installmentGraceDays: 5, downPaymentDueDays: 7, downPaymentGraceDays: 3 });
    await updateFinanceSettings(db, f.actors.superAdmin, { installment_grace_days: "10", down_payment_due_days: "14", down_payment_grace_days: "0" });
    expect(paymentTerms(await getFinanceSettings(db))).toEqual({ installmentGraceDays: 10, downPaymentDueDays: 14, downPaymentGraceDays: 0 });
    // Empty brings back the standard value; nonsense and too-long periods are refused.
    await updateFinanceSettings(db, f.actors.superAdmin, { installment_grace_days: "" });
    expect(paymentTerms(await getFinanceSettings(db)).installmentGraceDays).toBe(5);
    expect((await errorOf(updateFinanceSettings(db, f.actors.superAdmin, { installment_grace_days: "91" })))?.code).toBe("VALIDATION_FAILED");
    expect((await errorOf(updateFinanceSettings(db, f.actors.superAdmin, { down_payment_due_days: "two" })))?.code).toBe("VALIDATION_FAILED");
    expect((await errorOf(updateFinanceSettings(db, f.actors.hr, { installment_grace_days: "1" })))?.code).toBe("FORBIDDEN");
  });
});
