import { canDo } from "@/modules/leads/policy";
import { listRecordings, uploadRecording } from "@/modules/recordings/service";
import { MAX_RECORDING_BYTES, UPLOAD_OVERHEAD_BYTES } from "@/modules/recordings/validation";
import { assertCanUploadTo } from "@/modules/files/lead-files";
import { apiRoute } from "@/server/http";
import { AppError, forbidden } from "@/server/errors";

const tooLarge = () => new AppError("VALIDATION_FAILED", "Recordings can be at most 25 MB.", { fields: { file: "Recordings can be at most 25 MB." } });

/** GET — recordings on the lead (anyone who may view the lead). */
export const GET = apiRoute(async ({ db, actor, params }) => listRecordings(db, actor, params.id));

/**
 * POST multipart/form-data `file` (+ optional `durationSec`) — upload a call recording (FR-038).
 * The role, lead access and declared size are checked before the body is read; the content after.
 */
export const POST = apiRoute(async ({ req, db, actor, params }) => {
  if (!canDo(actor, "edit")) throw forbidden();
  // Lead access and the booked rule before reading the body, so an unauthorised request costs nothing.
  await assertCanUploadTo(db, actor, params.id);
  const declared = req.headers.get("content-length");
  if (!declared) throw new AppError("VALIDATION_FAILED", "Send the recording as a file upload.");
  if (Number(declared) > MAX_RECORDING_BYTES + UPLOAD_OVERHEAD_BYTES) throw tooLarge();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_FAILED", "Send the recording as a file upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_FAILED", "Choose a recording to upload.", { fields: { file: "Choose a recording to upload." } });
  if (file.size > MAX_RECORDING_BYTES) throw tooLarge();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return uploadRecording(db, actor, params.id, { bytes, name: file.name, durationSec: form.get("durationSec") });
}, 201);
