import { listDailyReports } from "@/modules/teams/queries";
import { apiRoute, queryObject } from "@/server/http";

/** GET ?from&to&team — date-wise submissions (admins / HR: all teams; managers: their own; default last 15 days). */
export const GET = apiRoute(async ({ req, db, actor }) => listDailyReports(db, actor, queryObject(req)));
