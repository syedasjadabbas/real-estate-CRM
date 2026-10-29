import { createClient } from "@/modules/clients/commands";
import { listClients } from "@/modules/clients/queries";
import { apiRoute, queryObject, readJson } from "@/server/http";

/** GET /api/v1/clients — search, sort and pagination (not project-scoped: clients span projects). */
export const GET = apiRoute(async ({ req, db, actor }) => listClients(db, actor, queryObject(req)));

/** POST /api/v1/clients — manual client (admins). */
export const POST = apiRoute(async ({ req, db, actor }) => createClient(db, actor, await readJson(req)), 201);
