import { sharedPhoneGroups } from "@/modules/leads/queries";
import { apiRoute, resolveProjectId } from "@/server/http";

export const GET = apiRoute(async ({ req, db, actor }) => sharedPhoneGroups(db, actor, await resolveProjectId(req, db), new URL(req.url).searchParams.get("page")));
