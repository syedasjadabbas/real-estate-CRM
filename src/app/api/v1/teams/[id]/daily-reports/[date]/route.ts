import { saveDailyReport } from "@/modules/teams/commands";
import { getDailyReport } from "@/modules/teams/queries";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor, params }) => getDailyReport(db, actor, params.id, params.date));

/** PUT { lines: [{ agentId, leads, calls, meetings, tokens, bookings, remarks? }] } — same day only. */
export const PUT = apiRoute(async ({ req, db, actor, params }) => saveDailyReport(db, actor, params.id, params.date, await readJson(req)));
