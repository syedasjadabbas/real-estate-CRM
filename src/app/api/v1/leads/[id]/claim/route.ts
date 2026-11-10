import { claimLead } from "@/modules/leads/claims";
import { apiRoute } from "@/server/http";

/** POST — claim an unassigned lead. First successful claim wins; a later one gets 409. Agents and managers. */
export const POST = apiRoute(async ({ db, actor, params }) => claimLead(db, actor, params.id));
