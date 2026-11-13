import { resubmitLead } from "@/modules/leads/verification";
import { apiRoute } from "@/server/http";

/** POST: sends a corrected, rejected lead back for verification. */
export const POST = apiRoute(async ({ db, actor, params }) => resubmitLead(db, actor, params.id));
