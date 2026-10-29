import { completeFollowUp } from "@/modules/leads/commands";
import { apiRoute } from "@/server/http";

export const POST = apiRoute(async ({ db, actor, params }) => completeFollowUp(db, actor, params.id));
