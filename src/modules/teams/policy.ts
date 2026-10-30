import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Teams / daily report / roster (USER_ROLES_AND_PERMISSIONS.md: F/F/T/R (own roster)/R/—).
 * Team setup and membership are admin-only (assumption T-A1): letting a manager add members would
 * widen that manager's lead scope.
 */
type Who = Pick<Actor, "id" | "role" | "managedTeamIds">;

const isAdmin = (a: Pick<Actor, "role">) => a.role === "super_admin" || a.role === "admin";

/** Can open the Teams area (Teams tab, daily reports, full roster). */
export function canViewTeams(actor: Pick<Actor, "role">) {
  return isAdmin(actor) || actor.role === "manager" || actor.role === "hr";
}

/** Sees every team (admins, HR read-only); managers see the teams they manage. */
export function seesAllTeams(actor: Pick<Actor, "role">) {
  return isAdmin(actor) || actor.role === "hr";
}

export function canManageTeams(actor: Pick<Actor, "role">) {
  return isAdmin(actor);
}

export function assertCanManageTeams(actor: Pick<Actor, "role">) {
  if (!canManageTeams(actor)) throw forbidden();
}

/** View one team's daily reports and roster. */
export function canViewTeam(actor: Who, teamId: string) {
  return seesAllTeams(actor) || (actor.role === "manager" && actor.managedTeamIds.includes(teamId));
}

/** Enter daily reports and edit the roster for a team (time locks are checked separately). */
export function canOperateTeam(actor: Who, teamId: string) {
  return isAdmin(actor) || (actor.role === "manager" && actor.managedTeamIds.includes(teamId));
}

/** Agents see only their own roster entries ("R (own roster)"). */
export function canViewOwnRoster(actor: Pick<Actor, "role">) {
  return actor.role === "agent";
}
