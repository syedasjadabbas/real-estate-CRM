import { requestReversal } from "@/modules/finance/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { reason } — accountant asks; a manager / admin decides. */
export const POST = apiRoute(async ({ req, db, actor, params }) => requestReversal(db, actor, params.id, await readJson(req)), 201);
