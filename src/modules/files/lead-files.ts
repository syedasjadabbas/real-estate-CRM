import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { files, leads, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { putObject, removeObject } from "@/server/storage/local";
import { canDo } from "@/modules/leads/policy";
import { audit, loadAccessibleLead, logActivity, touchValues } from "@/modules/leads/support";

/**
 * Shared storage path for files on leads (FR-038): call recordings and documents.
 * Upload: anyone who may edit the lead (owner agent, the owner's manager, admins), not on booked
 * leads — the note rule. Read: anyone who may view the lead (SECURITY_AND_PRIVACY.md §10).
 * HR and accountants: none. Out-of-scope leads and files are 404. No delete path exists.
 */
export type LeadFileKind = "call_recording" | "document";
const FOLDER: Record<LeadFileKind, string> = { call_recording: "recordings", document: "documents" };
const LABEL: Record<LeadFileKind, string> = { call_recording: "Recording", document: "Document" };

const uploader = alias(users, "file_uploader");

export async function assertCanUploadTo(db: Database, actor: Actor, leadId: string) {
  if (!canDo(actor, "edit")) throw forbidden();
  const { lead } = await loadAccessibleLead(db, actor, leadId);
  if (lead.stage === "booked") throw new AppError("BUSINESS_RULE", "Booked leads are read-only.");
  return lead;
}

/** Stores validated bytes privately, then records the file, timeline entry, audit row and touch. */
export async function saveLeadFile(
  db: Database,
  actor: Actor,
  leadId: string,
  file: { kind: LeadFileKind; bytes: Uint8Array; name: string; ext: string; mime: string; durationSec?: number | null; auditAction: string },
) {
  const lead = await assertCanUploadTo(db, actor, leadId);
  const id = randomUUID();
  const now = new Date();
  const storageKey = `${FOLDER[file.kind]}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${file.ext}`;
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  await putObject(storageKey, file.bytes);
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(leads).where(eq(leads.id, lead.id)).for("update");
      if (current.stage === "booked") throw new AppError("BUSINESS_RULE", "Booked leads are read-only.");
      await tx.insert(files).values({
        id,
        leadId: lead.id,
        kind: file.kind,
        storageKey,
        originalName: file.name,
        mime: file.mime,
        sizeBytes: file.bytes.byteLength,
        durationSec: file.durationSec ?? null,
        sha256,
        uploadedById: actor.id,
      });
      await tx.update(leads).set(touchValues(current, now)).where(eq(leads.id, lead.id));
      await logActivity(tx, { leadId: lead.id, actorId: actor.id, type: "file_uploaded", body: file.name, data: { fileId: id, kind: file.kind } });
      await audit(tx, actor, file.auditAction, lead.id, null, { fileId: id, name: file.name, sizeBytes: file.bytes.byteLength, sha256 });
      return { id, name: file.name, sizeBytes: file.bytes.byteLength, durationSec: file.durationSec ?? null };
    });
  } catch (error) {
    await removeObject(storageKey).catch(() => undefined);
    throw error;
  }
}

/** Files of one kind on a lead the actor may view, newest first. */
export async function listLeadFiles(db: Database, actor: Actor, leadId: string, kind: LeadFileKind) {
  if (!canDo(actor, "view")) throw forbidden();
  const { lead } = await loadAccessibleLead(db, actor, leadId);
  return db
    .select({
      id: files.id,
      name: files.originalName,
      mime: files.mime,
      sizeBytes: files.sizeBytes,
      durationSec: files.durationSec,
      createdAt: files.createdAt,
      uploadedBy: uploader.name,
    })
    .from(files)
    .leftJoin(uploader, eq(uploader.id, files.uploadedById))
    .where(and(eq(files.leadId, lead.id), eq(files.kind, kind)))
    .orderBy(desc(files.createdAt), desc(files.id));
}
export type LeadFileRow = Awaited<ReturnType<typeof listLeadFiles>>[number];

/** A file of `kind` the actor may read: 404 unless they may view its lead (no existence leak). */
export async function openLeadFile(db: Database, actor: Actor, fileId: string, kind: LeadFileKind) {
  if (!canDo(actor, "view")) throw forbidden();
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound(LABEL[kind]);
  const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.kind, kind))).limit(1);
  if (!file) throw notFound(LABEL[kind]);
  try {
    await loadAccessibleLead(db, actor, file.leadId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") throw notFound(LABEL[kind]);
    throw error;
  }
  return file;
}
