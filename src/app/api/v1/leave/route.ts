import { myLeave, submitLeave } from "@/modules/leave/service";
import { apiRoute, readJson } from "@/server/http";

/** GET — my leave balance and requests for the current year. POST { type, startDate, endDate, reason? } — request leave. */
export const GET = apiRoute(async ({ db, actor }) => myLeave(db, actor));
export const POST = apiRoute(async ({ req, db, actor }) => submitLeave(db, actor, await readJson(req)), 201);
