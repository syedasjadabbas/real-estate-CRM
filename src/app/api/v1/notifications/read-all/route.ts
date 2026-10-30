import { markAllRead } from "@/modules/notifications/service";
import { apiRoute } from "@/server/http";

/** POST — marks all of the signed-in user's notifications read. */
export const POST = apiRoute(async ({ db, actor }) => markAllRead(db, actor));
