import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { auditLogs, bookingPayments, bookings, files, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { putObject, removeObject } from "@/server/storage/local";
import { canAccessBooking } from "@/modules/bookings/policy";
import { DOCUMENT_FORMATS, documentFormatOf, MAX_DOCUMENT_BYTES, sniffDocument } from "@/modules/documents/validation";
import { teamMemberIds } from "@/modules/leads/support";
import { cleanFileName, extensionOf } from "@/modules/recordings/validation";
import { canDoFinance, canSeeItemisedPayments } from "./policy";

/**
 * Payment proofs (questionnaire Q33: "online receipt, cash images, cheque and pay order"): receipts,
 * screenshots or photos attached to a posted payment. Optional until the client confirms whether
 * proof is mandatory (C-23).
 * - Formats and limits are the lead-document rules: PDF, JPG, PNG, DOCX, XLSX, at most 10 MB,
 *   content-checked.
 * - Files are private (`payment-proofs/…`), streamed only through the authenticated route.
 * - Viewing follows itemised-payment access: finance roles, and managers for their team's bookings.
 *   Uploading follows payment recording (accountant, super admin).
 * - Proofs are never deleted; the payment record and its reference are not changed.
 */
const uploader = alias(users, "proof_uploader");
const fileError = (message: string) => new AppError("VALIDATION_FAILED", message, { fields: { file: message } });

/** The payment (not a reversal entry) and its booking, if the actor may see itemised payments for it. */
async function loadVisiblePayment(db: Database, actor: Actor, paymentId: string) {
  if (!canSeeItemisedPayments(actor)) throw forbidden();
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) throw notFound("Payment");
  const [row] = await db
    .select({ id: bookingPayments.id, kind: bookingPayments.kind, bookingId: bookings.id, leadId: bookings.leadId, agentId: bookings.agentId })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .where(eq(bookingPayments.id, paymentId))
    .limit(1);
  if (!row) throw notFound("Payment");
  if (!canDoFinance(actor, "viewAll") && !canAccessBooking(actor, row.agentId, await teamMemberIds(db, actor))) throw notFound("Payment");
  return row;
}

/** Checks role and access before the request body is read (used by the upload route). */
export async function assertCanAttachProof(db: Database, actor: Actor, paymentId: string) {
  if (!canDoFinance(actor, "record")) throw forbidden();
  const payment = await loadVisiblePayment(db, actor, paymentId);
  if (payment.kind !== "payment") throw new AppError("BUSINESS_RULE", "Attach proof to the payment, not to its reversal.");
  return payment;
}

export async function uploadPaymentProof(db: Database, actor: Actor, paymentId: string, input: { bytes: Uint8Array; name: string }) {
  const payment = await assertCanAttachProof(db, actor, paymentId);
  const name = cleanFileName(input.name);
  const declared = documentFormatOf(extensionOf(name));
  if (input.bytes.byteLength === 0) throw fileError("The file is empty.");
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw fileError("Proofs can be at most 10 MB.");
  if (!declared) throw fileError("Upload a PDF, JPG, PNG, DOCX or XLSX file.");
  const format = sniffDocument(input.bytes);
  if (format !== declared) throw fileError("The file content does not match its type.");

  const id = randomUUID();
  const now = new Date();
  const storageKey = `payment-proofs/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${format}`;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  await putObject(storageKey, input.bytes);
  try {
    return await db.transaction(async (tx) => {
      await tx.insert(files).values({
        id,
        leadId: payment.leadId,
        paymentId: payment.id,
        kind: "receipt",
        storageKey,
        originalName: name,
        mime: DOCUMENT_FORMATS[format].mime,
        sizeBytes: input.bytes.byteLength,
        sha256,
        uploadedById: actor.id,
      });
      await tx.insert(auditLogs).values({
        actorId: actor.id,
        ip: actor.ip ?? null,
        action: "payment.proof_upload",
        entity: "payment",
        entityId: payment.id,
        before: null,
        after: { fileId: id, name, sizeBytes: input.bytes.byteLength, sha256 },
      });
      return { id, name, sizeBytes: input.bytes.byteLength };
    });
  } catch (error) {
    await removeObject(storageKey).catch(() => undefined);
    throw error;
  }
}

/** Proofs on a payment, newest first. */
export async function listPaymentProofs(db: Database, actor: Actor, paymentId: string) {
  const payment = await loadVisiblePayment(db, actor, paymentId);
  return db
    .select({ id: files.id, name: files.originalName, mime: files.mime, sizeBytes: files.sizeBytes, createdAt: files.createdAt, uploadedBy: uploader.name })
    .from(files)
    .leftJoin(uploader, eq(uploader.id, files.uploadedById))
    .where(and(eq(files.paymentId, payment.id), eq(files.kind, "receipt"), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt), desc(files.id));
}
export type PaymentProofRow = Awaited<ReturnType<typeof listPaymentProofs>>[number];

/** A proof the actor may read; 404 otherwise (no existence leak). */
export async function openPaymentProof(db: Database, actor: Actor, fileId: string) {
  if (!canSeeItemisedPayments(actor)) throw forbidden();
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound("Proof");
  const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.kind, "receipt"), isNull(files.deletedAt))).limit(1);
  if (!file?.paymentId) throw notFound("Proof");
  try {
    await loadVisiblePayment(db, actor, file.paymentId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") throw notFound("Proof");
    throw error;
  }
  return file;
}
