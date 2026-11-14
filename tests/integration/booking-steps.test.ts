import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, createBooking } from "@/modules/bookings/commands";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { bookingStageHistory, files } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { bookingMode } from "../support/approved-leads";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const fieldOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return Object.keys(e.fields ?? {})[0] ?? e.code;
    throw e;
  }
};

/**
 * A booking's steps (owner, 14 Nov 2026): Token → (amount + proof) → Partial Down Payment → (signed
 * booking form, then amount + proof) → Complete Down Payment → (signed booking form) → Closed Won.
 */
describe.skipIf(!hasTestDb)("Booking steps (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
    bookingMode.requirePaperwork = true;
  });
  afterAll(async () => {
    bookingMode.requirePaperwork = false;
    await close();
  });
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
  });

  it("each step needs its amount, proof and signed booking form, in order", async () => {
    const r = await createLead(db, f.actors.agent1, leadInput(f));
    if (r.outcome !== "created") throw new Error("setup");
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "ST-1", areaSqft: "500", basePrice: "10000000" });
    const { bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: r.leadId, unitId, tokenAmount: "100000" });
    const file = async (kind: "document" | "receipt") =>
      (await db.insert(files).values({ bookingId, leadId: r.leadId, kind, storageKey: `t/${crypto.randomUUID()}.pdf`, originalName: `${kind}.pdf`, mime: "application/pdf", sizeBytes: 1, sha256: "x", uploadedById: f.actors.agent1.id }).returning({ id: files.id }))[0].id;

    // Token → Partial Down Payment: amount and a new proof (no booking form yet).
    expect(await fieldOf(advanceBooking(db, f.actors.agent1, bookingId, { toStage: "down_payment" }))).toBe("amount");
    expect(await fieldOf(advanceBooking(db, f.actors.agent1, bookingId, { toStage: "down_payment", amount: 1_000_000 }))).toBe("proof");
    expect(await fieldOf(advanceBooking(db, f.actors.agent1, bookingId, { toStage: "down_payment", amount: 1_000_000, proofFileId: await file("receipt") }))).toBe("ok");

    // Partial → Complete Down Payment: the booking form signed in this stage first.
    expect(await fieldOf(advanceBooking(db, f.actors.agent1, bookingId, { toStage: "agreement_pending", amount: 1_500_000, proofFileId: await file("receipt") }))).toBe("signedForm");
    await file("document");
    expect(await fieldOf(advanceBooking(db, f.actors.agent1, bookingId, { toStage: "agreement_pending", amount: 1_500_000, proofFileId: await file("receipt") }))).toBe("ok");

    // Complete Down Payment → Closed Won: signed again in this stage.
    expect(await fieldOf(advanceBooking(db, f.actors.superAdmin, bookingId, { toStage: "confirmed" }))).toBe("signedForm");
    await file("document");
    expect(await fieldOf(advanceBooking(db, f.actors.superAdmin, bookingId, { toStage: "confirmed" }))).toBe("ok");

    const notes = (await db.select({ note: bookingStageHistory.note }).from(bookingStageHistory)).map((h) => h.note ?? "");
    expect(notes.some((n) => n.startsWith("Amount received: PKR 1,000,000"))).toBe(true);
  });
});
