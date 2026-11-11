import { createMeeting } from "@/modules/meetings/commands";
import { listMeetings } from "@/modules/meetings/queries";
import { apiRoute, queryObject, readJson } from "@/server/http";

/** GET /api/v1/meetings?q&status&organizer=<id|me>&lead&overdue=1&sort&dir&page — within the actor's meetings scope. */
export const GET = apiRoute(async ({ req, db, actor }) => listMeetings(db, actor, queryObject(req)));

/** POST { title, startsAt, endsAt?, type, location?, organizerId?, leadId, notes?, moveLead? } */
export const POST = apiRoute(async ({ req, db, actor }) => createMeeting(db, actor, await readJson(req)), 201);
