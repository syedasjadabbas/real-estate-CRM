import { addReview } from "@/modules/leads/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { body } — managers (own teams) and admins only. */
export const POST = apiRoute(async ({ req, db, actor, params }) => addReview(db, actor, params.id, await readJson(req)), 201);
