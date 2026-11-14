import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { auditLogs, bookings, files, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, notFound } from "@/server/errors";
import { putObject, removeObject } from "@/server/storage/local";
import { DOCUMENT_FORMATS, documentFormatOf, MAX_DOCUMENT_BYTES, sniffDocument } from "@/modules/documents/validation";
import { teamMemberIds } from "@/modules/leads/support";
import { cleanFileName, extensionOf } from "@/modules/recordings/validation";
import { canAccessBooking, canDoBooking } from "./policy";

/**
 * Booking payment proofs (owner, 14 Nov 2026): the agent attaches the customer's transfer screenshot,
 * cheque or cash photo to the booking when the client pays, before Accounts posts the payment.
 * - Anyone who can open the booking can see and add them (agents their own bookings); not once cancelled.
 * - Same formats and checks as payment proofs: PDF, JPG, PNG, DOCX, XLSX, at most 10 MB, content-checked.
 * - Private files, served only through the authenticated route; never deleted; audited.
 */
const uploader = alias(users, "booking_proof_uploader");
const fileError = (message: string) => new AppError("VALIDATION_FAILED", message, { fields: { file: message } });

async function loadVisibleBooking(db: Database, actor: Actor, bookingId: string) {
  if (!canDoBooking(actor, "view") || !/^[0-9a-f-]{36}$/i.test(bookingId)) throw notFound("Booking");
  const [b] = await db
    .select({ id: bookings.id, leadId: bookings.leadId, agentId: bookings.agentId, stage: bookings.stage })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!b || !canAccessBooking(actor, b.agentId, await teamMemberIds(db, actor))) throw notFound("Booking");
  return b;
}

/** Checks access before the upload body is read (used by the route). */
export async function assertCanAddBookingProof(db: Database, actor: Actor, bookingId: string) {
  const booking = await loadVisibleBooking(db, actor, bookingId);
  if (booking.stage === "cancelled") throw new AppError("BUSINESS_RULE", "This booking is cancelled.");
  return booking;
}

export async function uploadBookingProof(db: Database, actor: Actor, bookingId: string, input: { bytes: Uint8Array; name: string }) {
  const booking = await assertCanAddBookingProof(db, actor, bookingId);
  const name = cleanFileName(input.name);
  const declared = documentFormatOf(extensionOf(name));
  if (input.bytes.byteLength === 0) throw fileError("The file is empty.");
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw fileError("Proofs can be at most 10 MB.");
  if (!declared) throw fileError("Upload a JPG, PNG or PDF (DOCX and XLSX also work).");
  const format = sniffDocument(input.bytes);
  if (format !== declared) throw fileError("The file content does not match its type.");

  const id = randomUUID();
  const now = new Date();
  const storageKey = `booking-proofs/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${format}`;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  await putObject(storageKey, input.bytes);
  try {
    return await db.transaction(async (tx) => {
      await tx.insert(files).values({
        id,
        leadId: booking.leadId,
        bookingId: booking.id,
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
        action: "booking.proof_upload",
        entity: "booking",
        entityId: booking.id,
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

/** Proofs on a booking, newest first. */
export async function listBookingProofs(db: Database, actor: Actor, bookingId: string) {
  const booking = await loadVisibleBooking(db, actor, bookingId);
  return db
    .select({ id: files.id, name: files.originalName, mime: files.mime, sizeBytes: files.sizeBytes, createdAt: files.createdAt, uploadedBy: uploader.name })
    .from(files)
    .leftJoin(uploader, eq(uploader.id, files.uploadedById))
    .where(and(eq(files.bookingId, booking.id), eq(files.kind, "receipt"), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt), desc(files.id));
}

/** A booking proof the actor may read; 404 otherwise (no existence leak). */
export async function openBookingProof(db: Database, actor: Actor, fileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound("Proof");
  const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.kind, "receipt"), isNull(files.deletedAt))).limit(1);
  if (!file?.bookingId) throw notFound("Proof");
  try {
    await loadVisibleBooking(db, actor, file.bookingId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") throw notFound("Proof");
    throw error;
  }
  return file;
}
