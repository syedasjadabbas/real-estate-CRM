import { updateProjectDimensions } from "@/modules/projects/commands";
import { apiRoute, readJson } from "@/server/http";

/** PUT { floors?, blocks?, categories?, types?, premiums? } — FR-061, super admin / admin. */
export const PUT = apiRoute(async ({ req, db, actor, params }) => updateProjectDimensions(db, actor, params.id, await readJson(req)));
