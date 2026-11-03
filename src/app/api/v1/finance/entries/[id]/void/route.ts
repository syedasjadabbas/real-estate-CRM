import { voidEntry } from "@/modules/finance/entries";
import { apiRoute, readJson } from "@/server/http";

/** POST { reason } — void an entry; nothing is deleted. */
export const POST = apiRoute(async ({ req, db, actor, params }) => voidEntry(db, actor, params.id, await readJson(req)));
