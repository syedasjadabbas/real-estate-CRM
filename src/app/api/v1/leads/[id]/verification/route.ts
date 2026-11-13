import { verifyLead } from "@/modules/leads/verification";
import { apiRoute, readJson } from "@/server/http";

/** POST { approve: boolean, note?: string }. Admin or Super Admin; rejecting needs a note. */
export const POST = apiRoute(async ({ req, db, actor, params }) => verifyLead(db, actor, params.id, await readJson(req)));
