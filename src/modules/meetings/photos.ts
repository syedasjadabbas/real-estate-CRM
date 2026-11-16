import { createHash, randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, files, meetingHistory, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { putObject, removeObject } from "@/server/storage/local";
import { cleanFileName, extensionOf } from "@/modules/recordings/validation";
import { loadAccessibleMeeting } from "./commands";
import { canDoMeeting } from "./policy";

/**
 * Meeting photos (owner, 16 Nov 2026): whoever runs a meeting (the organizer, its creator, or an Admin
 * or Super Admin) attaches pictures taken there, so Admins and Super Admins can see later that it
 * happened. Anyone who can open the meeting sees its photos: Admins and Super Admins see every
 * meeting's, an agent their own. Private files, served only through `/api/v1/meeting-photos/:id`.
 */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_MEETING = 20;
export const PHOTO_FORMATS = {
  jpg: { mime: "image/jpeg" },
  png: { mime: "image/png" },
  webp: { mime: "image/webp" },
} as const;
export type PhotoFormat = keyof typeof PHOTO_FORMATS;
export const PHOTO_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

const photoError = (message: string) => new AppError("VALIDATION_FAILED", message, { fields: { file: message } });

/** The format from the name (jpeg = jpg), or null. */
export function photoFormatOf(ext: string): PhotoFormat | null {
  const e = ext.toLowerCase() === "jpeg" ? "jpg" : ext.toLowerCase();
  return e in PHOTO_FORMATS ? (e as PhotoFormat) : null;
}

/** The format from the content: JPEG, PNG or WebP, or null. */
export function sniffPhoto(b: Uint8Array): PhotoFormat | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  const tag = (i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
  if (tag(0) === "RIFF" && tag(8) === "WEBP") return "webp";
  return null;
}

/** Uploading needs the meeting's edit rights, and the meeting must not be cancelled. */
async function meetingForUpload(db: Database | Parameters<Parameters<Database["transaction"]>[0]>[0], actor: Actor, meetingId: string, lock = false) {
  if (!canDoMeeting(actor, "edit")) throw forbidden();
  const { meeting } = await loadAccessibleMeeting(db, actor, meetingId, lock);
  if (meeting.status === "cancelled") throw new AppError("BUSINESS_RULE", "Photos can't be added to a cancelled meeting.");
  return meeting;
}

/** Checks before the body is read (the route calls this first). */
export const assertCanAddPhotos = (db: Database, actor: Actor, meetingId: string) => meetingForUpload(db, actor, meetingId);

export async function uploadMeetingPhoto(db: Database, actor: Actor, meetingId: string, input: { bytes: Uint8Array; name: string }) {
  await meetingForUpload(db, actor, meetingId);
  const name = cleanFileName(input.name || "photo");
  if (input.bytes.byteLength === 0) throw photoError("The photo is empty.");
  if (input.bytes.byteLength > MAX_PHOTO_BYTES) throw photoError("Photos can be at most 10 MB.");
  const format = sniffPhoto(input.bytes);
  if (!format) throw photoError("Upload a JPG, PNG or WebP photo.");
  const declared = photoFormatOf(extensionOf(name));
  if (declared && declared !== format) throw photoError("The file content does not match its type.");

  const id = randomUUID();
  const now = new Date();
  const storageKey = `meeting-photos/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${format}`;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  await putObject(storageKey, input.bytes);
  try {
    return await db.transaction(async (tx) => {
      const meeting = await meetingForUpload(tx, actor, meetingId, true);
      const [{ n }] = await tx.select({ n: count() }).from(files).where(and(eq(files.meetingId, meeting.id), isNull(files.deletedAt)));
      if (n >= MAX_PHOTOS_PER_MEETING) throw photoError(`A meeting can have at most ${MAX_PHOTOS_PER_MEETING} photos.`);
      await tx.insert(files).values({
        id,
        leadId: meeting.leadId,
        meetingId: meeting.id,
        kind: "meeting_photo",
        storageKey,
        originalName: name,
        mime: PHOTO_FORMATS[format].mime,
        sizeBytes: input.bytes.byteLength,
        sha256,
        uploadedById: actor.id,
      });
      const data = { fileId: id, name, sizeBytes: input.bytes.byteLength };
      await tx.insert(meetingHistory).values({ meetingId: meeting.id, actorId: actor.id, action: "photo_upload", data });
      await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "meeting.photo_upload", entity: "meeting", entityId: meeting.id, before: null, after: { ...data, sha256 } });
      return { id, name, sizeBytes: input.bytes.byteLength };
    });
  } catch (error) {
    await removeObject(storageKey).catch(() => undefined);
    throw error;
  }
}

export type MeetingPhoto = { id: string; name: string; sizeBytes: number; createdAt: Date; uploadedById: string | null; uploadedBy: string | null; canRemove: boolean };

/** A meeting's photos, newest first, for anyone who may open the meeting. */
export async function listMeetingPhotos(db: Database, actor: Actor, meetingId: string): Promise<MeetingPhoto[]> {
  if (!canDoMeeting(actor, "view")) throw forbidden();
  const { meeting } = await loadAccessibleMeeting(db, actor, meetingId);
  const rows = await db
    .select({ id: files.id, name: files.originalName, sizeBytes: files.sizeBytes, createdAt: files.createdAt, uploadedById: files.uploadedById, uploadedBy: users.name })
    .from(files)
    .leftJoin(users, eq(users.id, files.uploadedById))
    .where(and(eq(files.meetingId, meeting.id), eq(files.kind, "meeting_photo"), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt));
  return rows.map((r) => ({ ...r, canRemove: canRemovePhoto(actor, r.uploadedById) }));
}

/** The person who added it, or an Admin or Super Admin. */
export const canRemovePhoto = (actor: Pick<Actor, "id" | "role">, uploadedById: string | null) =>
  actor.role === "admin" || actor.role === "super_admin" || (uploadedById !== null && uploadedById === actor.id);

/** Photo counts per meeting (the meetings list). */
export async function photoCounts(db: Database, meetingIds: string[]) {
  if (meetingIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ meetingId: files.meetingId, n: count() })
    .from(files)
    .where(and(inArray(files.meetingId, meetingIds), eq(files.kind, "meeting_photo"), isNull(files.deletedAt)))
    .groupBy(files.meetingId);
  return new Map(rows.map((r) => [r.meetingId as string, Number(r.n)]));
}

/** A photo for someone who may open its meeting; 404 otherwise. */
export async function openMeetingPhoto(db: Database, actor: Actor, fileId: string) {
  if (!canDoMeeting(actor, "view")) throw forbidden();
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound("Photo");
  const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.kind, "meeting_photo"), isNull(files.deletedAt))).limit(1);
  if (!file?.meetingId) throw notFound("Photo");
  try {
    await loadAccessibleMeeting(db, actor, file.meetingId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") throw notFound("Photo");
    throw error;
  }
  return file;
}

/** Removes a photo from view (the row and stored file are kept, as for other files). Recorded. */
export async function removeMeetingPhoto(db: Database, actor: Actor, fileId: string) {
  const file = await openMeetingPhoto(db, actor, fileId);
  if (!canRemovePhoto(actor, file.uploadedById)) throw forbidden("Only the person who added the photo, or an Admin, can remove it.");
  return db.transaction(async (tx) => {
    const [gone] = await tx
      .update(files)
      .set({ deletedAt: new Date(), deletedById: actor.id })
      .where(and(eq(files.id, file.id), isNull(files.deletedAt)))
      .returning({ id: files.id });
    if (!gone) throw notFound("Photo");
    const data = { fileId: file.id, name: file.originalName };
    await tx.insert(meetingHistory).values({ meetingId: file.meetingId!, actorId: actor.id, action: "photo_remove", data });
    await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "meeting.photo_remove", entity: "meeting", entityId: file.meetingId!, before: data, after: null });
    return { removed: true };
  });
}
