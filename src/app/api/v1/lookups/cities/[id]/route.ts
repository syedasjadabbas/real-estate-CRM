import { updateCity } from "@/modules/cities/service";
import { apiRoute, readJson } from "@/server/http";

/** PATCH { name?, isActive? } — super admins and admins. Cities are never deleted. */
export const PATCH = apiRoute(async ({ req, db, actor, params }) => updateCity(db, actor, params.id, await readJson(req)));
