import { listClients } from "@/modules/clients/queries";
import { apiRoute, queryObject } from "@/server/http";

/** GET /api/v1/clients — search, sort and pagination (not project-scoped: clients span projects). */
export const GET = apiRoute(async ({ req, db, actor }) => listClients(db, actor, queryObject(req)));
// No POST: clients are created only through leads (owner, 15 Nov 2026: "Add client" removed).
