import { updateTeam } from "@/modules/teams/commands";
import { teamDetail } from "@/modules/teams/queries";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor, params }) => teamDetail(db, actor, params.id));

/** PATCH { name?, managerId?, isActive? } — admins. Teams are deactivated, never deleted. */
export const PATCH = apiRoute(async ({ req, db, actor, params }) => updateTeam(db, actor, params.id, await readJson(req)));
