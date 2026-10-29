import { pendingLostRequests } from "@/modules/leads/queries";
import { apiRoute, resolveProjectId } from "@/server/http";

/** GET pending lost requests the user may decide. */
export const GET = apiRoute(async ({ req, db, actor }) => pendingLostRequests(db, actor, await resolveProjectId(req, db)));
