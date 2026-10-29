import { advanceBooking } from "@/modules/bookings/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { toStage, note? } — next stage only. */
export const POST = apiRoute(async ({ req, db, actor, params }) => advanceBooking(db, actor, params.id, await readJson(req)));
