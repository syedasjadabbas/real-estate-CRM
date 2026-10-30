import { deleteHoliday, updateHoliday } from "@/modules/holidays/service";
import { apiRoute, readJson } from "@/server/http";

/** PATCH { date?, name?, scope?, region? } — HR and admins. */
export const PATCH = apiRoute(async ({ req, db, actor, params }) => updateHoliday(db, actor, params.id, await readJson(req)));

/** DELETE — HR and admins; the audit log keeps the removed holiday. */
export const DELETE = apiRoute(async ({ db, actor, params }) => deleteHoliday(db, actor, params.id));
