import { markLost } from "@/modules/leads/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { lostReasonId, note? } — direct for managers/admins, approval request for agents. */
export const POST = apiRoute(async ({ req, db, actor, params }) => markLost(db, actor, params.id, await readJson(req)));
