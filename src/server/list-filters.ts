import { and, asc, eq, gte, lt, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { addDays } from "@/modules/bookings/today";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { teams } from "@/server/db/schema";

/**
 * Shared list filters for Tasks and Meetings (owner review, 16 Nov 2026): a Team filter and a
 * From / To date range, so Admins who see every team can narrow long lists.
 */

/** `column` is a member of the team, or its manager. Always combined with the caller's own scope filter. */
export function inTeam(column: AnyColumn, teamId: string): SQL {
  return or(
    sql`${column} in (select user_id from team_members where team_id = ${teamId})`,
    sql`${column} = (select manager_id from teams where id = ${teamId})`,
  )!;
}

/** `column` falls on or between two business days (Asia/Karachi), either end optional. */
export function onDays(column: AnyColumn, from?: string, to?: string): SQL | undefined {
  return and(
    from ? gte(column, new Date(`${from}T00:00:00+05:00`)) : undefined,
    to ? lt(column, new Date(`${addDays(to, 1)}T00:00:00+05:00`)) : undefined,
  );
}

/** Teams offered in the Team filter: every active team for "all" scope, the teams they manage for "team" scope. */
export async function teamFilterOptions(db: Database, actor: Pick<Actor, "id">, scope: string) {
  if (scope !== "all" && scope !== "team") return [];
  return db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.isActive, true), scope === "team" ? eq(teams.managerId, actor.id) : undefined))
    .orderBy(asc(teams.name));
}
