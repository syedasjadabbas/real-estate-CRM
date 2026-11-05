import { addCity, listCities } from "@/modules/cities/service";
import { apiRoute, readJson } from "@/server/http";

/** GET — the whole list with usage counts. Super admins and admins. */
export const GET = apiRoute(async ({ db, actor }) => listCities(db, actor));

/** POST { name } — super admins and admins. */
export const POST = apiRoute(async ({ req, db, actor }) => addCity(db, actor, await readJson(req)), 201);
