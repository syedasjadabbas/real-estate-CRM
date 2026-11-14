import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { auditLogs, bookings, files, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { putObject, removeObject } from "@/server/storage/local";
import { teamMemberIds } from "@/modules/leads/support";
import { cleanFileName, extensionOf } from "@/modules/recordings/validation";
import { DOCUMENT_FORMATS, documentFormatOf, MAX_DOCUMENT_BYTES, sniffDocument } from "@/modules/documents/validation";
import { canAccessBooking, canDoBooking } from "./policy";

/**
 * Signed booking forms (owner, 14 Nov 2026): the agent prints the booking form, the client signs it,
 * and a scan or photo is uploaded back onto the booking. Kept as "document" files on the booking
 * (files.booking_id), apart from the transfer screenshots ("receipt") on the same booking. Anyone
 * who may see the booking may upload and open them; nothing is deleted.
 */
const fileError = (message: string) => new AppError("VALIDATION_FAILED", message, { fields: { file: message } });
const uploader = alias(users, "signed_form_uploader");

/** The booking, if the actor may see it (404 otherwise). */
export async function loadVisibleBooking(db: Database, actor: Actor, bookingId: string) {
  if (!canDoBooking(actor, "view")) throw forbidden();
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) throw notFound("Booking");
  const [b] = await db.select({ id: bookings.id, agentId: bookings.agentId, stage: bookings.stage, leadId: bookings.leadId }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!b || !canAccessBooking(actor, b.agentId, await teamMemberIds(db, actor))) throw notFound("Booking");
  return b;
}

export async function assertCanUploadSignedForm(db: Database, actor: Actor, bookingId: string) {
  const b = await loadVisibleBooking(db, actor, bookingId);
  if (b.stage === "cancelled") throw new AppError("BUSINESS_RULE", "This booking is cancelled.");
  return b;
}

export async function uploadSignedBookingForm(db: Database, actor: Actor, bookingId: string, input: { bytes: Uint8Array; name: string }) {
  const visible = await assertCanUploadSignedForm(db, actor, bookingId);
  const name = cleanFileName(input.name);
  const declared = documentFormatOf(extensionOf(name));
  if (input.bytes.byteLength === 0) throw fileError("The file is empty.");
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw fileError("Documents can be at most 10 MB.");
  if (!declared) throw fileError("Upload a PDF, JPG or PNG of the signed form.");
  const format = sniffDocument(input.bytes);
  if (format !== declared) throw fileError("The file content does not match its type.");

  const id = randomUUID();
  const now = new Date();
  const storageKey = `booking-forms/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${format}`;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  await putObject(storageKey, input.bytes);
  try {
    return await db.transaction(async (tx) => {
      const [b] = await tx.select({ stage: bookings.stage }).from(bookings).where(eq(bookings.id, bookingId)).for("update");
      if (!b || b.stage === "cancelled") throw new AppError("BUSINESS_RULE", "This booking is cancelled.");
      // Also on the booking's lead (every file belongs to a lead, client or entry), so it shows in the lead's documents too.
      await tx.insert(files).values({ id, bookingId, leadId: visible.leadId, kind: "document", storageKey, originalName: name, mime: DOCUMENT_FORMATS[format].mime, sizeBytes: input.bytes.byteLength, sha256, uploadedById: actor.id });
      await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "booking.signed_form_upload", entity: "booking", entityId: bookingId, after: { fileId: id, name, sizeBytes: input.bytes.byteLength, sha256 } });
      return { id, name, sizeBytes: input.bytes.byteLength };
    });
  } catch (error) {
    await removeObject(storageKey).catch(() => undefined);
    throw error;
  }
}

/** The booking's signed forms, newest first. */
export async function listSignedBookingForms(db: Database, actor: Actor, bookingId: string) {
  await loadVisibleBooking(db, actor, bookingId);
  return db
    .select({ id: files.id, name: files.originalName, mime: files.mime, sizeBytes: files.sizeBytes, createdAt: files.createdAt, uploadedBy: uploader.name })
    .from(files)
    .leftJoin(uploader, eq(uploader.id, files.uploadedById))
    .where(and(eq(files.bookingId, bookingId), eq(files.kind, "document"), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt), desc(files.id));
}
