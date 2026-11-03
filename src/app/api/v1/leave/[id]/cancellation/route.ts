import { decideLeaveCancellation, requestLeaveCancellation } from "@/modules/leave/service";
import { apiRoute, readJson } from "@/server/http";

/** POST { reason } by the requester, or { approve, comment? } by an Admin / Super Admin (Q15). */
export const POST = apiRoute(async ({ req, db, actor, params }) => {
  const body = await readJson(req);
  return "approve" in body ? decideLeaveCancellation(db, actor, params.id, body) : requestLeaveCancellation(db, actor, params.id, body);
});
