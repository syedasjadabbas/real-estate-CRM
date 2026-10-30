import { createHoliday, listHolidays } from "@/modules/holidays/service";
import { apiRoute, queryObject, readJson } from "@/server/http";

/** GET ?year&scope&region&q&sort&dir — HR, admins, managers (read-only). */
export const GET = apiRoute(async ({ req, db, actor }) => listHolidays(db, actor, queryObject(req)));

/** POST { date, name, scope, region? } — HR and admins. */
export const POST = apiRoute(async ({ req, db, actor }) => createHoliday(db, actor, await readJson(req)), 201);
