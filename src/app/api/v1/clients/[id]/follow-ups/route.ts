import { scheduleClientFollowUp } from "@/modules/clients/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { dueAt, note? } */
export const POST = apiRoute(async ({ req, db, actor, params }) => scheduleClientFollowUp(db, actor, params.id, await readJson(req)), 201);
