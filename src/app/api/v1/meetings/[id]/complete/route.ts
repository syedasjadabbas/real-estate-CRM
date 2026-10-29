import { completeMeeting } from "@/modules/meetings/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { note?, moveLead? } — Scheduled → Completed; moveLead (default true) moves the lead forward to Meeting Done. */
export const POST = apiRoute(async ({ req, db, actor, params }) => completeMeeting(db, actor, params.id, await readJson(req)));
