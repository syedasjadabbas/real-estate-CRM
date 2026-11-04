import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { clients, files, leads, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, notFound } from "@/server/errors";
import { putObject, removeObject } from "@/server/storage/local";
import { assertCanClient } from "@/modules/clients/policy";
import { auditClient, loadAccessibleClient, logClientActivity } from "@/modules/clients/support";
import { assertCanUploadTo, listLeadFiles, openLeadFile, saveLeadFile } from "@/modules/files/lead-files";
import { canDo } from "@/modules/leads/policy";
import { scopeFilter } from "@/modules/leads/support";
import { cleanFileName, extensionOf } from "@/modules/recordings/validation";
import { DOCUMENT_FORMATS, documentFormatOf, MAX_DOCUMENT_BYTES, sniffDocument } from "./validation";

const fileError = (message: string) => new AppError("VALIDATION_FAILED", message, { fields: { file: message } });

const uploader = alias(users, "document_uploader");

/** The cleaned name and real format of an upload: a permitted type, within the limit, whose content matches. */
function checkDocument(input: { bytes: Uint8Array; name: string }) {
  const name = cleanFileName(input.name);
  const declared = documentFormatOf(extensionOf(name));
  if (input.bytes.byteLength === 0) throw fileError("The file is empty.");
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw fileError("Documents can be at most 10 MB.");
  if (!declared) throw fileError("Upload a PDF, JPG, PNG, DOCX or XLSX file.");
  const format = sniffDocument(input.bytes);
  if (format !== declared) throw fileError("The file content does not match its type.");
  return { name, format };
}

/** Documents on leads (FR-038): same storage and lead rules as call recordings. */
export async function uploadDocument(db: Database, actor: Actor, leadId: string, input: { bytes: Uint8Array; name: string }) {
  await assertCanUploadTo(db, actor, leadId);
  const { name, format } = checkDocument(input);
  return saveLeadFile(db, actor, leadId, { kind: "document", bytes: input.bytes, name, ext: format, mime: DOCUMENT_FORMATS[format].mime, auditAction: "lead.document_upload" });
}

export const listDocuments = (db: Database, actor: Actor, leadId: string) => listLeadFiles(db, actor, leadId, "document");

/** Anyone who may edit the client (owner agent, the owner's manager, admins). Out-of-scope clients are 404. */
export async function assertCanUploadToClient(db: Database, actor: Actor, clientId: string) {
  assertCanClient(actor, "edit");
  return (await loadAccessibleClient(db, actor, clientId)).client;
}

/**
 * Contracts and other documents kept on the client itself (FR-052). They live on the client, not a
 * lead, because a booked lead is read-only and a client added by hand has no lead.
 */
export async function uploadClientDocument(db: Database, actor: Actor, clientId: string, input: { bytes: Uint8Array; name: string }) {
  await assertCanUploadToClient(db, actor, clientId);
  const { name, format } = checkDocument(input);
  const id = randomUUID();
  const now = new Date();
  const storageKey = `documents/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${format}`;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  await putObject(storageKey, input.bytes);
  try {
    return await db.transaction(async (tx) => {
      await loadAccessibleClient(tx, actor, clientId, true);
      await tx.insert(files).values({ id, clientId, kind: "document", storageKey, originalName: name, mime: DOCUMENT_FORMATS[format].mime, sizeBytes: input.bytes.byteLength, sha256, uploadedById: actor.id });
      await tx.update(clients).set({ lastActivityAt: now, updatedAt: now }).where(eq(clients.id, clientId));
      await logClientActivity(tx, { clientId, actorId: actor.id, type: "file_uploaded", body: name, data: { fileId: id } });
      await auditClient(tx, actor, "client.document_upload", clientId, null, { fileId: id, name, sizeBytes: input.bytes.byteLength, sha256 });
      return { id, name, sizeBytes: input.bytes.byteLength };
    });
  } catch (error) {
    await removeObject(storageKey).catch(() => undefined);
    throw error;
  }
}

/**
 * The client page's documents, newest first: those on the client, then the documents of its leads
 * that the actor may open in Leads (accountants see the client's own only, as they have no leads).
 */
export async function listClientDocuments(db: Database, actor: Actor, clientId: string) {
  assertCanClient(actor, "view");
  const { members } = await loadAccessibleClient(db, actor, clientId);
  const fields = { id: files.id, name: files.originalName, mime: files.mime, sizeBytes: files.sizeBytes, createdAt: files.createdAt, uploadedBy: uploader.name };
  const own = await db
    .select(fields)
    .from(files)
    .leftJoin(uploader, eq(uploader.id, files.uploadedById))
    .where(and(eq(files.clientId, clientId), eq(files.kind, "document"), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt), desc(files.id));
  if (!canDo(actor, "view")) return own.map((d) => ({ ...d, origin: null }));
  const fromLeads = await db
    .select({ ...fields, leadCode: leads.code })
    .from(files)
    .innerJoin(leads, eq(leads.id, files.leadId))
    .leftJoin(uploader, eq(uploader.id, files.uploadedById))
    .where(and(eq(leads.clientId, clientId), isNull(leads.deletedAt), scopeFilter(actor, members), eq(files.kind, "document"), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt), desc(files.id));
  return [...own.map((d) => ({ ...d, origin: null })), ...fromLeads.map(({ leadCode, ...d }) => ({ ...d, origin: `Lead ${leadCode}` }))];
}

/** A document for someone who may view its client or, for a lead document, its lead (404 otherwise). */
export async function openDocument(db: Database, actor: Actor, fileId: string) {
  if (/^[0-9a-f-]{36}$/i.test(fileId)) {
    const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.kind, "document"), isNull(files.deletedAt))).limit(1);
    if (file?.clientId) {
      assertCanClient(actor, "view");
      await loadAccessibleClient(db, actor, file.clientId).catch((error) => {
        throw error instanceof AppError && error.code === "NOT_FOUND" ? notFound("Document") : error;
      });
      return file;
    }
  }
  return openLeadFile(db, actor, fileId, "document");
}
