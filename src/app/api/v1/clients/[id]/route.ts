import { updateClient } from "@/modules/clients/commands";
import { getClientDetail } from "@/modules/clients/queries";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor, params }) => getClientDetail(db, actor, params.id));
export const PATCH = apiRoute(async ({ req, db, actor, params }) => updateClient(db, actor, params.id, await readJson(req)));
