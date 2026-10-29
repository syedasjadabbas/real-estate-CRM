import { convertLeadToClient } from "@/modules/clients/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { leadId, onExisting?: "reject" | "link" } — managers (own team) and admins. */
export const POST = apiRoute(async ({ req, db, actor }) => convertLeadToClient(db, actor, await readJson(req)), 201);
