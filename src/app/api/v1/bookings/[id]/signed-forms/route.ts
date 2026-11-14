import { assertCanUploadSignedForm, listSignedBookingForms, uploadSignedBookingForm } from "@/modules/bookings/signed-forms";
import { MAX_DOCUMENT_BYTES } from "@/modules/documents/validation";
import { UPLOAD_OVERHEAD_BYTES } from "@/modules/recordings/validation";
import { apiRoute } from "@/server/http";
import { AppError } from "@/server/errors";

const tooLarge = () => new AppError("VALIDATION_FAILED", "Documents can be at most 10 MB.", { fields: { file: "Documents can be at most 10 MB." } });

/** GET: the booking's signed booking forms, newest first. */
export const GET = apiRoute(async ({ db, actor, params }) => listSignedBookingForms(db, actor, params.id));

/** POST multipart/form-data `file`: a scan or photo of the signed booking form. Access and size are checked before the body is read. */
export const POST = apiRoute(async ({ req, db, actor, params }) => {
  await assertCanUploadSignedForm(db, actor, params.id);
  const declared = req.headers.get("content-length");
  if (!declared) throw new AppError("VALIDATION_FAILED", "Send the form as a file upload.");
  if (Number(declared) > MAX_DOCUMENT_BYTES + UPLOAD_OVERHEAD_BYTES) throw tooLarge();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_FAILED", "Send the form as a file upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_FAILED", "Choose the signed form to upload.", { fields: { file: "Choose the signed form to upload." } });
  if (file.size > MAX_DOCUMENT_BYTES) throw tooLarge();
  return uploadSignedBookingForm(db, actor, params.id, { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name });
}, 201);
