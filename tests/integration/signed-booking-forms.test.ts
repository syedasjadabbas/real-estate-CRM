import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cancelBooking, createBooking } from "@/modules/bookings/commands";
import { listSignedBookingForms, uploadSignedBookingForm } from "@/modules/bookings/signed-forms";
import { openDocument } from "@/modules/documents/service";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { auditLogs, files } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const enc = (s: string) => new TextEncoder().encode(s);
const pdf = () => {
  const b = new Uint8Array(256);
  b.set(enc("%PDF-1.7\n%âãÏÓ\n"));
  return b;
};
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

/** Signed booking forms (owner, 14 Nov 2026): print, sign, upload back onto the booking. */
describe.skipIf(!hasTestDb)("Signed booking forms (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let storageDir: string;
  let previousStorage: string | undefined;

  beforeAll(async () => {
    ({ db, close } = connectTestDb());
    storageDir = await mkdtemp(path.join(tmpdir(), "mz-signed-forms-"));
    previousStorage = process.env.FILE_STORAGE_DIR;
    process.env.FILE_STORAGE_DIR = storageDir;
  });
  afterAll(async () => {
    if (previousStorage === undefined) delete process.env.FILE_STORAGE_DIR;
    else process.env.FILE_STORAGE_DIR = previousStorage;
    await rm(storageDir, { recursive: true, force: true });
    await close();
  });
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
  });

  const booking = async () => {
    const r = await createLead(db, f.actors.agent1, leadInput(f));
    if (r.outcome !== "created") throw new Error("setup");
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: `SF-${Math.random().toString(36).slice(2, 7)}`, areaSqft: "500", basePrice: "10000000" });
    return (await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: r.leadId, unitId, tokenAmount: "100000" })).bookingId;
  };

  it("the agent uploads the signed form; it is listed, opens for the booking's viewers only, and is audited", async () => {
    const bookingId = await booking();
    const up = await uploadSignedBookingForm(db, f.actors.agent1, bookingId, { bytes: pdf(), name: "signed form.pdf" });
    const list = await listSignedBookingForms(db, f.actors.superAdmin, bookingId);
    expect(list.map((d) => d.name)).toEqual(["signed form.pdf"]);
    const [row] = await db.select().from(files).where(eq(files.id, up.id));
    expect(row).toMatchObject({ bookingId, kind: "document" });
    expect(row.leadId).not.toBeNull();
    expect((await openDocument(db, f.actors.agent1, up.id)).id).toBe(up.id);
    expect(await codeOf(openDocument(db, f.actors.outsideAgent, up.id))).toBe("NOT_FOUND");
    expect(await codeOf(listSignedBookingForms(db, f.actors.outsideAgent, bookingId))).toBe("NOT_FOUND");
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "booking.signed_form_upload"))).length).toBe(1);
  });

  it("refuses the wrong file type and a cancelled booking", async () => {
    const bookingId = await booking();
    expect(await codeOf(uploadSignedBookingForm(db, f.actors.agent1, bookingId, { bytes: enc("not a pdf"), name: "x.pdf" }))).toBe("VALIDATION_FAILED");
    await cancelBooking(db, f.actors.superAdmin, bookingId, { reason: "Buyer withdrew" });
    expect(await codeOf(uploadSignedBookingForm(db, f.actors.agent1, bookingId, { bytes: pdf(), name: "late.pdf" }))).toBe("BUSINESS_RULE");
  });
});
