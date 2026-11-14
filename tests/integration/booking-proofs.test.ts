import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cancelBooking, createBooking } from "@/modules/bookings/commands";
import { listBookingProofs, openBookingProof, uploadBookingProof } from "@/modules/bookings/proofs";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { auditLogs } from "@/server/db/schema";
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
const png = () => {
  const b = new Uint8Array(256);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b;
};

/** Owner, 14 Nov 2026: agents attach the client's transfer screenshot to the booking. */
describe.skipIf(!hasTestDb)("Booking payment proofs (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let storageDir: string;
  let bookingId: string;

  beforeAll(async () => {
    ({ db, close } = connectTestDb());
    storageDir = await mkdtemp(path.join(tmpdir(), "mz-booking-proofs-"));
    process.env.FILE_STORAGE_DIR = storageDir;
  });
  afterAll(async () => {
    delete process.env.FILE_STORAGE_DIR;
    await close();
    await rm(storageDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const lead = await createLead(db, f.actors.agent1, leadInput(f));
    if (lead.outcome !== "created") throw new Error("setup");
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "BP-1", areaSqft: "500", basePrice: "10000000" });
    ({ bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: lead.leadId, unitId, tokenAmount: "500000" }));
  });

  it("the booking's agent attaches a screenshot; it is listed, opens, and is audited", async () => {
    const r = await uploadBookingProof(db, f.actors.agent1, bookingId, { bytes: png(), name: "transfer.png" });
    const list = await listBookingProofs(db, f.actors.agent1, bookingId);
    expect(list.map((p) => [p.name, p.uploadedBy])).toEqual([["transfer.png", "Agent A"]]);
    expect((await openBookingProof(db, f.actors.superAdmin, r.id)).bookingId).toBe(bookingId);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "booking.proof_upload"))).length).toBe(1);
  });

  it("another agent can't see or add proofs; wrong content and cancelled bookings are refused", async () => {
    const r = await uploadBookingProof(db, f.actors.agent1, bookingId, { bytes: png(), name: "transfer.png" });
    expect(await codeOf(listBookingProofs(db, f.actors.agent2, bookingId))).toBe("NOT_FOUND");
    expect(await codeOf(openBookingProof(db, f.actors.agent2, r.id))).toBe("NOT_FOUND");
    expect(await codeOf(uploadBookingProof(db, f.actors.agent2, bookingId, { bytes: png(), name: "x.png" }))).toBe("NOT_FOUND");
    expect(await codeOf(uploadBookingProof(db, f.actors.agent1, bookingId, { bytes: png(), name: "fake.pdf" }))).toBe("VALIDATION_FAILED");
    await cancelBooking(db, f.actors.superAdmin, bookingId, { reason: "Client withdrew" });
    expect(await codeOf(uploadBookingProof(db, f.actors.agent1, bookingId, { bytes: png(), name: "late.png" }))).toBe("BUSINESS_RULE");
  });
});
