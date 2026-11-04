import { assertCanUploadToClient, listClientDocuments, uploadClientDocument } from "@/modules/documents/service";
import { MAX_DOCUMENT_BYTES } from "@/modules/documents/validation";
import { UPLOAD_OVERHEAD_BYTES } from "@/modules/recordings/validation";
import { apiRoute } from "@/server/http";
import { AppError } from "@/server/errors";

const tooLarge = () => new AppError("VALIDATION_FAILED", "Documents can be at most 10 MB.", { fields: { file: "Documents can be at most 10 MB." } });

/** GET — the client's documents and those of its leads the actor may open. */
export const GET = apiRoute(async ({ db, actor, params }) => listClientDocuments(db, actor, params.id));

/** POST multipart/form-data `file` — keep a contract or document on the client (FR-052). Access and size are checked before the body is read. */
export const POST = apiRoute(async ({ req, db, actor, params }) => {
  await assertCanUploadToClient(db, actor, params.id);
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
  return uploadClientDocument(db, actor, params.id, { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name });
}, 201);
