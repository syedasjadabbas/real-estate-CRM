import { createLead } from "@/modules/leads/commands";
import { listLeads } from "@/modules/leads/queries";
import { apiRoute, queryObject, readJson, resolveProjectId } from "@/server/http";

/** GET /api/v1/leads — filters, search, sort and pagination as documented in API_DESIGN.md. */
export const GET = apiRoute(async ({ req, db, actor }) => listLeads(db, actor, await resolveProjectId(req, db), queryObject(req)));

/** POST /api/v1/leads — create (duplicate check + automatic assignment). */
export const POST = apiRoute(async ({ req, db, actor }) => createLead(db, actor, await readJson(req)), 201);
