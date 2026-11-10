import { getImportBatch } from "@/modules/leads/imports";
import { apiRoute } from "@/server/http";

/** GET — one batch with its rows (uploader or Super Admin). */
export const GET = apiRoute(async ({ db, actor, params }) => getImportBatch(db, actor, params.id));
