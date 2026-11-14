import { MAX_DOCUMENT_BYTES } from "@/modules/documents/validation";
import { assertCanAddBookingProof, listBookingProofs, uploadBookingProof } from "@/modules/bookings/proofs";
import { UPLOAD_OVERHEAD_BYTES } from "@/modules/recordings/validation";
import { apiRoute } from "@/server/http";
import { AppError } from "@/server/errors";

const tooLarge = () => new AppError("VALIDATION_FAILED", "Proofs can be at most 10 MB.", { fields: { file: "Proofs can be at most 10 MB." } });

/** GET — transfer screenshots and other proofs attached to the booking (anyone who can open it). */
export const GET = apiRoute(async ({ db, actor, params }) => listBookingProofs(db, actor, params.id));

/** POST multipart/form-data `file` — attach a proof to the booking (14 Nov 2026). Access is checked before the body is read. */
export const POST = apiRoute(async ({ req, db, actor, params }) => {
  await assertCanAddBookingProof(db, actor, params.id);
  const declared = req.headers.get("content-length");
  if (!declared) throw new AppError("VALIDATION_FAILED", "Send the proof as a file upload.");
  if (Number(declared) > MAX_DOCUMENT_BYTES + UPLOAD_OVERHEAD_BYTES) throw tooLarge();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_FAILED", "Send the proof as a file upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_FAILED", "Choose a file to upload.", { fields: { file: "Choose a file to upload." } });
  if (file.size > MAX_DOCUMENT_BYTES) throw tooLarge();
  return uploadBookingProof(db, actor, params.id, { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name });
}, 201);
