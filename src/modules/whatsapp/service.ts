import { z } from "zod";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { listLeadFiles, openLeadFile, saveLeadFile } from "@/modules/files/lead-files";
import { PHOTO_FORMATS, sniffPhoto } from "@/modules/meetings/photos";
import { cleanFileName } from "@/modules/recordings/validation";

/**
 * WhatsApp proof on a lead (owner, 18 Nov 2026). Agents can't record WhatsApp calls, so they upload a
 * screenshot instead:
 * - a **call** screenshot counts as one call, like a recording (Performance, Targets, daily report,
 *   talk time), with the call length the agent reads off the screenshot;
 * - **chat** screenshots are proof of the conversation; they show on the timeline and, like any file,
 *   count as the lead's first touch, but not as a call.
 * Same rules as other lead files: upload = anyone who may edit the lead; view = anyone who may view it.
 */
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const WHATSAPP_KINDS = ["whatsapp_call", "whatsapp_chat"] as const;
export type WhatsappKind = (typeof WHATSAPP_KINDS)[number];

const fileError = (message: string) => new AppError("VALIDATION_FAILED", message, { fields: { file: message } });

/** "3:25", "1:02:10" or plain seconds → seconds; 1 s to 24 h. */
export const callLengthSchema = z
  .string("Enter the call length")
  .trim()
  .min(1, "Enter the call length from the screenshot")
  .transform((v, ctx) => {
    const parts = v.split(":").map((p) => p.trim());
    if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) {
      ctx.addIssue({ code: "custom", message: "Use minutes:seconds, e.g. 3:25" });
      return z.NEVER;
    }
    const n = parts.map(Number);
    const sec = n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n.length === 2 ? n[0] * 60 + n[1] : n[0];
    if (sec < 1 || sec > 86_400) {
      ctx.addIssue({ code: "custom", message: "The call length must be between 1 second and 24 hours" });
      return z.NEVER;
    }
    return sec;
  });

export async function uploadWhatsapp(db: Database, actor: Actor, leadId: string, input: { kind: WhatsappKind; bytes: Uint8Array; name: string; length?: string | null }) {
  if (!WHATSAPP_KINDS.includes(input.kind)) throw new AppError("VALIDATION_FAILED", "Choose call or chat.");
  if (input.bytes.byteLength === 0) throw fileError("The screenshot is empty.");
  if (input.bytes.byteLength > MAX_SCREENSHOT_BYTES) throw fileError("Screenshots can be at most 10 MB.");
  const format = sniffPhoto(input.bytes);
  if (!format) throw fileError("Upload a JPG, PNG or WebP screenshot.");
  let durationSec: number | null = null;
  if (input.kind === "whatsapp_call") {
    const parsed = callLengthSchema.safeParse(input.length ?? "");
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", parsed.error.issues[0].message, { fields: { length: parsed.error.issues[0].message } });
    durationSec = parsed.data;
  }
  const base = cleanFileName(input.name || "screenshot").replace(/\.[a-z0-9]+$/i, "") || "screenshot";
  return saveLeadFile(db, actor, leadId, {
    kind: input.kind,
    bytes: input.bytes,
    name: `${base}.${format}`,
    ext: format,
    mime: PHOTO_FORMATS[format].mime,
    durationSec,
    auditAction: input.kind === "whatsapp_call" ? "lead.whatsapp_call_upload" : "lead.whatsapp_chat_upload",
  });
}

/** Both kinds on a lead, newest first, each tagged with its kind. */
export async function listWhatsapp(db: Database, actor: Actor, leadId: string) {
  const [calls, chats] = await Promise.all([listLeadFiles(db, actor, leadId, "whatsapp_call"), listLeadFiles(db, actor, leadId, "whatsapp_chat")]);
  return [...calls.map((f) => ({ ...f, kind: "whatsapp_call" as const })), ...chats.map((f) => ({ ...f, kind: "whatsapp_chat" as const }))].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
export type WhatsappRow = Awaited<ReturnType<typeof listWhatsapp>>[number];

/** A screenshot for someone who may view its lead; 404 otherwise. */
export async function openWhatsapp(db: Database, actor: Actor, fileId: string) {
  try {
    return await openLeadFile(db, actor, fileId, "whatsapp_call");
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") return openLeadFile(db, actor, fileId, "whatsapp_chat");
    throw error;
  }
}
