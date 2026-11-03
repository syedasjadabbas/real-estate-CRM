import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, createBooking } from "@/modules/bookings/commands";
import { listDocuments } from "@/modules/documents/service";
import { recordPayment, requestReversal, decideReversal } from "@/modules/finance/commands";
import { listPaymentProofs, openPaymentProof, uploadPaymentProof } from "@/modules/finance/proofs";
import { listPaymentMethods } from "@/modules/finance/queries";
import { getPaymentDetail } from "@/modules/finance/views";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, bookingPayments, files, users } from "@/server/db/schema";
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
const enc = (s: string) => new TextEncoder().encode(s);
const pad = (head: ArrayLike<number>, size = 256) => {
  const b = new Uint8Array(size);
  b.set(head);
  return b;
};
const jpg = () => pad([0xff, 0xd8, 0xff, 0xe0]);
const pdf = () => pad(enc("%PDF-1.7\n"));

describe.skipIf(!hasTestDb)("Payment proofs (Q33, PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let accountant: Actor;
  let admin: Actor;
  let storageDir: string;
  let paymentId: string;
  let bookingLeadId: string;

  beforeAll(async () => {
    ({ db, close } = connectTestDb());
    storageDir = await mkdtemp(path.join(tmpdir(), "mz-proofs-"));
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
    const make = async (name: string, email: string, role: Role) => {
      const [u] = await db.insert(users).values({ name, email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    accountant = await make("Accountant", "acc@test.local", "accountant");
    admin = await make("Admin", "admin@test.local", "admin");
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "P-1", areaSqft: "500", basePrice: "1" });
    const lead = await createLead(db, f.actors.agent1, leadInput(f));
    if (lead.outcome !== "created") throw new Error("lead");
    bookingLeadId = lead.leadId;
    const { bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: lead.leadId, unitId, ratePerSqft: "25000", tokenAmount: "500000" });
    await advanceBooking(db, f.actors.superAdmin, bookingId, { toStage: "token_pending" });
    const cashId = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash")!.id;
    ({ paymentId } = await recordPayment(db, accountant, { bookingId, type: "token", amount: "500000", receivedOn: "2026-11-01", methodId: cashId, reference: "CASH-1" }));
  });

  it("an accountant attaches a cash photo and a receipt PDF; the payment and its reference are unchanged", async () => {
    const [before] = await db.select().from(bookingPayments).where(eq(bookingPayments.id, paymentId));
    const photo = await uploadPaymentProof(db, accountant, paymentId, { bytes: jpg(), name: "cash photo.jpeg" });
    await uploadPaymentProof(db, accountant, paymentId, { bytes: pdf(), name: "online receipt.pdf" });
    const proofs = await listPaymentProofs(db, accountant, paymentId);
    expect(proofs.map((p) => [p.name, p.mime])).toEqual([
      ["online receipt.pdf", "application/pdf"],
      ["cash photo.jpeg", "image/jpeg"],
    ]);
    const [after] = await db.select().from(bookingPayments).where(eq(bookingPayments.id, paymentId));
    expect(after).toEqual(before);

    const [row] = await db.select().from(files).where(eq(files.id, photo.id));
    expect(row).toMatchObject({ kind: "receipt", paymentId, leadId: bookingLeadId });
    expect(row.storageKey).toMatch(/^payment-proofs\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    expect((await stat(path.join(storageDir, row.storageKey))).size).toBe(256);
    // Shown in the payment's audit trail.
    expect((await getPaymentDetail(db, accountant, paymentId)).trail.map((t) => t.action)).toContain("payment.proof_upload");
    // Proofs never appear among the lead's documents.
    expect(await listDocuments(db, f.actors.agent1, bookingLeadId)).toEqual([]);
  });

  it("only payment recorders upload; itemised-payment viewers read; everyone else is refused", async () => {
    const { id } = await uploadPaymentProof(db, accountant, paymentId, { bytes: jpg(), name: "p.jpg" });
    for (const actor of [admin, f.actors.manager, f.actors.agent1, f.actors.hr]) {
      expect(await errorCode(uploadPaymentProof(db, actor, paymentId, { bytes: jpg(), name: "x.jpg" })), actor.role).toBe("FORBIDDEN");
    }
    expect(await errorCode(uploadPaymentProof(db, f.actors.superAdmin, paymentId, { bytes: jpg(), name: "x.jpg" }))).toBe("ok");
    // Read: finance roles and the booking's team manager; a manager of another team sees nothing.
    for (const actor of [accountant, admin, f.actors.superAdmin, f.actors.manager]) expect(await errorCode(openPaymentProof(db, actor, id)), actor.role).toBe("ok");
    for (const actor of [f.actors.agent1, f.actors.hr]) expect(await errorCode(openPaymentProof(db, actor, id)), actor.role).toBe("FORBIDDEN");
    const [outsideManager] = await db.insert(users).values({ name: "Other Mgr", email: "om@test.local", role: "manager", passwordHash: "x" }).returning();
    const om = await loadActor(db, { id: outsideManager.id, name: outsideManager.name, email: outsideManager.email, role: "manager" });
    expect(await errorCode(openPaymentProof(db, om, id))).toBe("NOT_FOUND");
    expect(await errorCode(listPaymentProofs(db, om, paymentId))).toBe("NOT_FOUND");
  });

  it("checks content, size and target: wrong content, empty files, reversals and other file kinds are refused", async () => {
    expect(await errorCode(uploadPaymentProof(db, accountant, paymentId, { bytes: pdf(), name: "photo.jpg" }))).toBe("VALIDATION_FAILED");
    expect(await errorCode(uploadPaymentProof(db, accountant, paymentId, { bytes: new Uint8Array(0), name: "a.pdf" }))).toBe("VALIDATION_FAILED");
    expect(await errorCode(uploadPaymentProof(db, accountant, paymentId, { bytes: pad(enc("<html>")), name: "a.html" }))).toBe("VALIDATION_FAILED");
    expect(await errorCode(uploadPaymentProof(db, accountant, paymentId, { bytes: pad([0xff, 0xd8, 0xff], 10 * 1024 * 1024 + 1), name: "big.jpg" }))).toBe("VALIDATION_FAILED");
    expect(await errorCode(uploadPaymentProof(db, accountant, "00000000-0000-4000-8000-000000000000", { bytes: jpg(), name: "a.jpg" }))).toBe("NOT_FOUND");
    // A reversal entry can't carry proof; the proof stays on the original payment.
    const { requestId } = await requestReversal(db, accountant, paymentId, { reason: "Entered twice" });
    const { reversalId } = await decideReversal(db, admin, requestId, { approve: true, note: "ok" });
    expect(await errorCode(uploadPaymentProof(db, accountant, reversalId!, { bytes: jpg(), name: "a.jpg" }))).toBe("BUSINESS_RULE");
    // Opening a lead document id through the proof route is 404.
    const [doc] = await db.insert(files).values({ leadId: bookingLeadId, kind: "document", storageKey: "documents/2026/11/00000000-0000-4000-8000-000000000001.pdf", originalName: "d.pdf", mime: "application/pdf", sizeBytes: 1, sha256: "x" }).returning();
    expect(await errorCode(openPaymentProof(db, accountant, doc.id))).toBe("NOT_FOUND");
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.action, "payment.proof_upload")))).length).toBe(0);
  });
});
