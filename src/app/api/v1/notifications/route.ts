import { listNotifications } from "@/modules/notifications/service";
import { apiRoute, queryObject } from "@/server/http";

/** GET ?unread=1&page — the signed-in user's own notifications and unread count (any role). */
export const GET = apiRoute(async ({ req, db, actor }) => listNotifications(db, actor, queryObject(req)));
