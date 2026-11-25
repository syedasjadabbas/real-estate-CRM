import { requestBooked } from "@/modules/bookings/booked-request";
import { MAX_DOCUMENT_BYTES } from "@/modules/documents/validation";
import { apiRoute } from "@/server/http";
import { AppError } from "@/server/errors";

const MAX_FILES = 5;
const tooLarge = () => new AppError("VALIDATION_FAILED", "Screenshots can be at most 10 MB each.", { fields: { files: "At most 10 MB each" } });

/** POST multipart/form-data: `files` (1 to 5), `unitId` and `tokenAmount` (or `bookingId`), `note`. The sale then waits for an Admin. */
export const POST = apiRoute(async ({ req, db, actor, params }) => {
  const declared = Number(req.headers.get("content-length"));
  if (!declared || declared > MAX_DOCUMENT_BYTES * MAX_FILES + 100_000) throw tooLarge();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_FAILED", "Send the screenshots as a file upload.");
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.some((f) => f.size > MAX_DOCUMENT_BYTES)) throw tooLarge();
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v ? v : undefined;
  };
  return requestBooked(
    db,
    actor,
    params.id,
    { bookingId: text("bookingId"), unitId: text("unitId"), tokenAmount: text("tokenAmount"), note: text("note") },
    await Promise.all(files.slice(0, MAX_FILES + 1).map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))),
  );
}, 201);
