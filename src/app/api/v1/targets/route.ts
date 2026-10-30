import { listTargets, setTarget } from "@/modules/targets/service";
import { apiRoute, queryObject, readJson } from "@/server/http";

/** GET ?period=daily|weekly|monthly&anchor=YYYY-MM-DD — targets with achievement, in the actor's scope. */
export const GET = apiRoute(async ({ req, db, actor }) => listTargets(db, actor, queryObject(req)));

/** PUT { userId, period, anchor, calls, meetings, soldSqft } — admins / team managers; all zero clears. */
export const PUT = apiRoute(async ({ req, db, actor }) => setTarget(db, actor, await readJson(req)));
