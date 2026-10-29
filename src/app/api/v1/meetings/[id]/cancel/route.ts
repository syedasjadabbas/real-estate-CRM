import { cancelMeeting } from "@/modules/meetings/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { note? } — Scheduled → Cancelled. */
export const POST = apiRoute(async ({ req, db, actor, params }) => cancelMeeting(db, actor, params.id, await readJson(req)));
