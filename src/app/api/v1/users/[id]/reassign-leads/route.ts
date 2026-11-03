import { ownedLeadSummary, reassignOwnedLeads } from "@/modules/accounts/service";
import { apiRoute, readJson } from "@/server/http";

/** GET — counts of the user's open, lost and booked leads. */
export const GET = apiRoute(async ({ db, actor, params }) => ownedLeadSummary(db, actor, params.id));

/** POST { toUserId, open?, lost?, booked? } — the "lead shift option" (Q3). */
export const POST = apiRoute(async ({ req, db, actor, params }) => reassignOwnedLeads(db, actor, params.id, await readJson(req)));
