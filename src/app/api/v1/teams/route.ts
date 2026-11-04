import { createTeam } from "@/modules/teams/commands";
import { listTeams, teamTiles } from "@/modules/teams/queries";
import { apiRoute, queryObject, readJson } from "@/server/http";

/** GET ?sort=&dir=&page= — teams the actor may see (admins / HR: all; managers: their own), 50 per page, with the observed tiles. */
export const GET = apiRoute(async ({ req, db, actor }) => {
  const { rows, ...list } = await listTeams(db, actor, queryObject(req));
  return { ...list, teams: rows, tiles: await teamTiles(db, actor) };
});

/** POST { name, managerId?, isActive? } — admins. */
export const POST = apiRoute(async ({ req, db, actor }) => createTeam(db, actor, await readJson(req)), 201);
