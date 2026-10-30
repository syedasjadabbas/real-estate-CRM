import { createTeam } from "@/modules/teams/commands";
import { teamTiles, visibleTeams } from "@/modules/teams/queries";
import { apiRoute, readJson } from "@/server/http";

/** GET teams the actor may see (admins / HR: all; managers: their own) with the observed tiles. */
export const GET = apiRoute(async ({ db, actor }) => ({ teams: await visibleTeams(db, actor), tiles: await teamTiles(db, actor) }));

/** POST { name, managerId?, isActive? } — admins. */
export const POST = apiRoute(async ({ req, db, actor }) => createTeam(db, actor, await readJson(req)), 201);
