import { updateProject } from "@/modules/projects/commands";
import { getProjectDetail } from "@/modules/projects/queries";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor, params }) => getProjectDetail(db, actor, params.id));

/** PATCH — super admin / admin; includes activate / deactivate via `status`. */
export const PATCH = apiRoute(async ({ req, db, actor, params }) => updateProject(db, actor, params.id, await readJson(req)));
