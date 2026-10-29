import { cancelBooking } from "@/modules/bookings/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { reason } — managers (own team) and admins; releases the unit. */
export const POST = apiRoute(async ({ req, db, actor, params }) => cancelBooking(db, actor, params.id, await readJson(req)));
