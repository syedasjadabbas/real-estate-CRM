import { pipelineBoard } from "@/modules/leads/queries";
import { apiRoute, queryObject, resolveProjectId } from "@/server/http";

export const GET = apiRoute(async ({ req, db, actor }) =>
  pipelineBoard(db, actor, await resolveProjectId(req, db), queryObject(req)),
);
