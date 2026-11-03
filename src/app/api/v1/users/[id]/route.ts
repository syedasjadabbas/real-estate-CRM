import { updateAccount } from "@/modules/accounts/service";
import { apiRoute, readJson } from "@/server/http";

/** PATCH { name?, role? } — Admin, Super Admin; only a Super Admin manages Super Admin accounts. */
export const PATCH = apiRoute(async ({ req, db, actor, params }) => updateAccount(db, actor, params.id, await readJson(req)));
