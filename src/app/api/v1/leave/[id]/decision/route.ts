import { decideLeave } from "@/modules/leave/service";
import { apiRoute, readJson } from "@/server/http";

/** POST { approve, comment? } — decide the current approval step (Q6, Q7). */
export const POST = apiRoute(async ({ req, db, actor, params }) => decideLeave(db, actor, params.id, await readJson(req)));
