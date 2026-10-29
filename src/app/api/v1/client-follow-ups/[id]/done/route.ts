import { completeClientFollowUp } from "@/modules/clients/commands";
import { apiRoute } from "@/server/http";

export const POST = apiRoute(async ({ db, actor, params }) => completeClientFollowUp(db, actor, params.id));
