import { createUnit } from "@/modules/inventory/commands";
import { listUnits } from "@/modules/inventory/queries";
import { apiRoute, queryObject, readJson } from "@/server/http";
import { getProjectScope } from "@/server/project-scope";

/** GET /api/v1/units?project=<id|all>&q&status&saleModel&nature&page — defaults to the selected project. */
export const GET = apiRoute(async ({ req, db, actor }) => listUnits(db, actor, queryObject(req), (await getProjectScope()).activeProjectId));

/** POST /api/v1/units — super admin / admin. */
export const POST = apiRoute(async ({ req, db, actor }) => createUnit(db, actor, await readJson(req)), 201);
