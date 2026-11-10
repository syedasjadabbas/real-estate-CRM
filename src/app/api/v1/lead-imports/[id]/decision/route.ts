import { decideImportBatch } from "@/modules/leads/imports";
import { apiRoute, readJson } from "@/server/http";

/** POST { approve: boolean, note? } — Super Admin only; a reason is required to reject. */
export const POST = apiRoute(async ({ req, db, actor, params }) => decideImportBatch(db, actor, params.id, await readJson(req)));
