import { listDocuments, uploadDocument } from "@/modules/documents/service";
import { MAX_DOCUMENT_BYTES } from "@/modules/documents/validation";
import { canDo } from "@/modules/leads/policy";
import { UPLOAD_OVERHEAD_BYTES } from "@/modules/recordings/validation";
import { assertCanUploadTo } from "@/modules/files/lead-files";
import { apiRoute } from "@/server/http";
import { AppError, forbidden } from "@/server/errors";

const tooLarge = () => new AppError("VALIDATION_FAILED", "Documents can be at most 10 MB.", { fields: { file: "Documents can be at most 10 MB." } });

/** GET — documents on the lead (anyone who may view the lead). */
export const GET = apiRoute(async ({ db, actor, params }) => listDocuments(db, actor, params.id));

/** POST multipart/form-data `file` — upload a document (FR-038). Role, lead access and size are checked before the body is read. */
export const POST = apiRoute(async ({ req, db, actor, params }) => {
  if (!canDo(actor, "edit")) throw forbidden();
  // Lead access and the booked rule before reading the body, so an unauthorised request costs nothing.
  await assertCanUploadTo(db, actor, params.id);
  const declared = req.headers.get("content-length");
  if (!declared) throw new AppError("VALIDATION_FAILED", "Send the document as a file upload.");
  if (Number(declared) > MAX_DOCUMENT_BYTES + UPLOAD_OVERHEAD_BYTES) throw tooLarge();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_FAILED", "Send the document as a file upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_FAILED", "Choose a document to upload.", { fields: { file: "Choose a document to upload." } });
  if (file.size > MAX_DOCUMENT_BYTES) throw tooLarge();
  return uploadDocument(db, actor, params.id, { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name });
}, 201);
