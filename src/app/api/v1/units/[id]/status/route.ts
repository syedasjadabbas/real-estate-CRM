import { setUnitStatus } from "@/modules/inventory/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { status, reason } — admin override until Bookings drives status. */
export const POST = apiRoute(async ({ req, db, actor, params }) => setUnitStatus(db, actor, params.id, await readJson(req)));
