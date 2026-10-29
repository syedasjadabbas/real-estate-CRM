import { addClientNote } from "@/modules/clients/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { body } */
export const POST = apiRoute(async ({ req, db, actor, params }) => addClientNote(db, actor, params.id, await readJson(req)), 201);
