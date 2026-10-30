import { markRead } from "@/modules/notifications/service";
import { apiRoute } from "@/server/http";

/** POST — marks one of the signed-in user's notifications read (404 for anyone else's). */
export const POST = apiRoute(async ({ db, actor, params }) => markRead(db, actor, params.id));
