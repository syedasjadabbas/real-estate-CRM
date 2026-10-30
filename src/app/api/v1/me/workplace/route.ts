import { getMyWorkplace } from "@/modules/workplace/service";
import { apiRoute, queryObject } from "@/server/http";

/** GET ?event&page — the signed-in user's upcoming holidays and own sign-in log (any role). */
export const GET = apiRoute(async ({ req, db, actor }) => getMyWorkplace(db, actor, queryObject(req)));
