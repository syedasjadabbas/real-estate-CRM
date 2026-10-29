import { updateMeeting } from "@/modules/meetings/commands";
import { getMeetingDetail } from "@/modules/meetings/queries";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor, params }) => getMeetingDetail(db, actor, params.id));

/** PATCH any field of a Scheduled meeting. Status changes use /complete and /cancel. */
export const PATCH = apiRoute(async ({ req, db, actor, params }) => updateMeeting(db, actor, params.id, await readJson(req)));
