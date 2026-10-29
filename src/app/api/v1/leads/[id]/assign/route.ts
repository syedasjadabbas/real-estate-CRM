import { assignLead } from "@/modules/leads/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { ownerId } — managers (own teams) and admins only. */
export const POST = apiRoute(async ({ req, db, actor, params }) => assignLead(db, actor, params.id, await readJson(req)));
