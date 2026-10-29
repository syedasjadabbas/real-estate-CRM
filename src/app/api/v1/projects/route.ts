import { createProject } from "@/modules/projects/commands";
import { listProjects } from "@/modules/projects/queries";
import { apiRoute, queryObject, readJson } from "@/server/http";

/** GET /api/v1/projects — search, type / status filters, pagination, KPI totals. */
export const GET = apiRoute(async ({ req, db, actor }) => listProjects(db, actor, queryObject(req)));

/** POST /api/v1/projects — super admin / admin. */
export const POST = apiRoute(async ({ req, db, actor }) => createProject(db, actor, await readJson(req)), 201);
