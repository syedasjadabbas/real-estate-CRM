import { MAX_DOCUMENT_BYTES } from "@/modules/documents/validation";
import { attachEntryFile, listEntryFiles } from "@/modules/finance/entries";
import { assertCanFinance } from "@/modules/finance/policy";
import { UPLOAD_OVERHEAD_BYTES } from "@/modules/recordings/validation";
import { apiRoute } from "@/server/http";
import { AppError } from "@/server/errors";

const tooLarge = () => new AppError("VALIDATION_FAILED", "Attachments can be at most 10 MB.", { fields: { file: "Attachments can be at most 10 MB." } });

export const GET = apiRoute(async ({ db, actor, params }) => listEntryFiles(db, actor, params.id));

/** POST multipart/form-data `file` — attach a receipt or document to an entry. Role is checked before the body is read. */
export const POST = apiRoute(async ({ req, db, actor, params }) => {
  assertCanFinance(actor, "record");
  const declared = req.headers.get("content-length");
  if (!declared) throw new AppError("VALIDATION_FAILED", "Send the attachment as a file upload.");
  if (Number(declared) > MAX_DOCUMENT_BYTES + UPLOAD_OVERHEAD_BYTES) throw tooLarge();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_FAILED", "Send the attachment as a file upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_FAILED", "Choose a file to upload.", { fields: { file: "Choose a file to upload." } });
  if (file.size > MAX_DOCUMENT_BYTES) throw tooLarge();
  return attachEntryFile(db, actor, params.id, { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name });
}, 201);
