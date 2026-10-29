import { decideReversal } from "@/modules/finance/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { approve, note? } — manager (own team) / admin / super admin. */
export const POST = apiRoute(async ({ req, db, actor, params }) => decideReversal(db, actor, params.id, await readJson(req)));
