import { scheduleFollowUp } from "@/modules/leads/commands";
import { getLeadDetail } from "@/modules/leads/queries";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor, params }) => (await getLeadDetail(db, actor, params.id)).followUps);

/** POST { dueAt (ISO), note? } */
export const POST = apiRoute(
  async ({ req, db, actor, params }) => scheduleFollowUp(db, actor, params.id, await readJson(req)),
  201,
);
