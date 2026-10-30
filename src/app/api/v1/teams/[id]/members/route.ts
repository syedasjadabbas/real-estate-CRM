import { setTeamMembers } from "@/modules/teams/commands";
import { apiRoute, readJson } from "@/server/http";

/** PUT { userIds } — replaces the member list (admins; active agents / managers only). */
export const PUT = apiRoute(async ({ req, db, actor, params }) => setTeamMembers(db, actor, params.id, await readJson(req)));
