import { decideLostRequest } from "@/modules/leads/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { approve: boolean, comment? } — managers (own teams) and admins only. */
export const POST = apiRoute(async ({ req, db, actor, params }) => decideLostRequest(db, actor, params.id, await readJson(req)));
