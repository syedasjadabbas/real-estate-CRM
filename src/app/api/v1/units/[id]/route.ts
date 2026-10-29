import { updateUnit } from "@/modules/inventory/commands";
import { getUnitDetail } from "@/modules/inventory/queries";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor, params }) => getUnitDetail(db, actor, params.id));
export const PATCH = apiRoute(async ({ req, db, actor, params }) => updateUnit(db, actor, params.id, await readJson(req)));
