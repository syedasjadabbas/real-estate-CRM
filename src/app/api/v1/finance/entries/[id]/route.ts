import { getEntry, updateEntry } from "@/modules/finance/entries";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor, params }) => getEntry(db, actor, params.id));
/** PATCH — edit an entry that isn't voided (audited before / after). */
export const PATCH = apiRoute(async ({ req, db, actor, params }) => updateEntry(db, actor, params.id, await readJson(req)));
