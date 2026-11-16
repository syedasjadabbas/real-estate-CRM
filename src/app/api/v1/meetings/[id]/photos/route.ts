import { assertCanAddPhotos, listMeetingPhotos, MAX_PHOTO_BYTES, uploadMeetingPhoto } from "@/modules/meetings/photos";
import { UPLOAD_OVERHEAD_BYTES } from "@/modules/recordings/validation";
import { apiRoute } from "@/server/http";
import { AppError } from "@/server/errors";

const tooLarge = () => new AppError("VALIDATION_FAILED", "Photos can be at most 10 MB.", { fields: { file: "Photos can be at most 10 MB." } });

/** GET — the meeting's photos (anyone who may open the meeting). */
export const GET = apiRoute(async ({ db, actor, params }) => listMeetingPhotos(db, actor, params.id));

/** POST multipart/form-data `file` — add a photo (owner, 16 Nov 2026). Access and size are checked before the body is read. */
export const POST = apiRoute(async ({ req, db, actor, params }) => {
  await assertCanAddPhotos(db, actor, params.id);
  const declared = req.headers.get("content-length");
  if (!declared) throw new AppError("VALIDATION_FAILED", "Send the photo as a file upload.");
  if (Number(declared) > MAX_PHOTO_BYTES + UPLOAD_OVERHEAD_BYTES) throw tooLarge();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_FAILED", "Send the photo as a file upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_FAILED", "Choose a photo to upload.", { fields: { file: "Choose a photo to upload." } });
  if (file.size > MAX_PHOTO_BYTES) throw tooLarge();
  return uploadMeetingPhoto(db, actor, params.id, { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name });
}, 201);
