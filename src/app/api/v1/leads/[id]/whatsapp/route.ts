import { assertCanUploadTo } from "@/modules/files/lead-files";
import { UPLOAD_OVERHEAD_BYTES } from "@/modules/recordings/validation";
import { listWhatsapp, MAX_SCREENSHOT_BYTES, uploadWhatsapp, WHATSAPP_KINDS, type WhatsappKind } from "@/modules/whatsapp/service";
import { apiRoute } from "@/server/http";
import { AppError } from "@/server/errors";

const tooLarge = () => new AppError("VALIDATION_FAILED", "Screenshots can be at most 10 MB.", { fields: { file: "Screenshots can be at most 10 MB." } });

/** GET — the lead's WhatsApp call and chat screenshots (anyone who may view the lead). */
export const GET = apiRoute(async ({ db, actor, params }) => listWhatsapp(db, actor, params.id));

/**
 * POST multipart/form-data: `file`, `kind` (whatsapp_call | whatsapp_chat) and, for a call, `length`
 * (e.g. 3:25). Lead access and size are checked before the body is read (owner, 18 Nov 2026).
 */
export const POST = apiRoute(async ({ req, db, actor, params }) => {
  await assertCanUploadTo(db, actor, params.id);
  const declared = req.headers.get("content-length");
  if (!declared) throw new AppError("VALIDATION_FAILED", "Send the screenshot as a file upload.");
  if (Number(declared) > MAX_SCREENSHOT_BYTES + UPLOAD_OVERHEAD_BYTES) throw tooLarge();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_FAILED", "Send the screenshot as a file upload.");
  }
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");
  if (!(file instanceof File)) throw new AppError("VALIDATION_FAILED", "Choose a screenshot to upload.", { fields: { file: "Choose a screenshot to upload." } });
  if (!(WHATSAPP_KINDS as readonly string[]).includes(kind)) throw new AppError("VALIDATION_FAILED", "Choose call or chat.");
  if (file.size > MAX_SCREENSHOT_BYTES) throw tooLarge();
  const length = form.get("length");
  return uploadWhatsapp(db, actor, params.id, { kind: kind as WhatsappKind, bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, length: typeof length === "string" ? length : null });
}, 201);
