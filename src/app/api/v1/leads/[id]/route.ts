import { updateLead } from "@/modules/leads/commands";
import { getLeadDetail } from "@/modules/leads/queries";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor, params }) => getLeadDetail(db, actor, params.id));
export const PATCH = apiRoute(async ({ req, db, actor, params }) => updateLead(db, actor, params.id, await readJson(req)));
