import { addNote } from "@/modules/leads/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { body } */
export const POST = apiRoute(async ({ req, db, actor, params }) => addNote(db, actor, params.id, await readJson(req)), 201);
