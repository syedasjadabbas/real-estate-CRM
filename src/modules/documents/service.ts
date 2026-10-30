import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { assertCanUploadTo, listLeadFiles, openLeadFile, saveLeadFile } from "@/modules/files/lead-files";
import { cleanFileName, extensionOf } from "@/modules/recordings/validation";
import { DOCUMENT_FORMATS, documentFormatOf, MAX_DOCUMENT_BYTES, sniffDocument } from "./validation";

const fileError = (message: string) => new AppError("VALIDATION_FAILED", message, { fields: { file: message } });

/** Documents on leads (FR-038): same storage and lead rules as call recordings. */
export async function uploadDocument(db: Database, actor: Actor, leadId: string, input: { bytes: Uint8Array; name: string }) {
  await assertCanUploadTo(db, actor, leadId);
  const name = cleanFileName(input.name);
  const declared = documentFormatOf(extensionOf(name));
  if (input.bytes.byteLength === 0) throw fileError("The file is empty.");
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw fileError("Documents can be at most 10 MB.");
  if (!declared) throw fileError("Upload a PDF, JPG, PNG, DOCX or XLSX file.");
  const format = sniffDocument(input.bytes);
  if (format !== declared) throw fileError("The file content does not match its type.");
  return saveLeadFile(db, actor, leadId, { kind: "document", bytes: input.bytes, name, ext: format, mime: DOCUMENT_FORMATS[format].mime, auditAction: "lead.document_upload" });
}

export const listDocuments = (db: Database, actor: Actor, leadId: string) => listLeadFiles(db, actor, leadId, "document");
export const openDocument = (db: Database, actor: Actor, fileId: string) => openLeadFile(db, actor, fileId, "document");
