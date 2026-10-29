import { changeStage } from "@/modules/leads/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { stage } */
export const POST = apiRoute(async ({ req, db, actor, params }) => changeStage(db, actor, params.id, await readJson(req)));
