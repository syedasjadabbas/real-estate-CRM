import type { Actor, Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Clients authorization (USER_ROLES_AND_PERMISSIONS.md: Clients F/F/T/O/—/R) plus the
 * milestone decision that only managers (own team) and admins create clients.
 * Pure functions; the service resolves team membership and passes it in.
 */
export type ClientScope = "all" | "team" | "own" | "none";

export function clientScope(role: Role): ClientScope {
  switch (role) {
    case "super_admin":
    case "admin":
    case "accountant":
      return "all";
    case "manager":
      return "team";
    case "agent":
      return "own";
    default:
      return "none";
  }
}

export type ClientAction = "view" | "createManual" | "convertLead" | "edit" | "assign";

const ROLE_ACTIONS: Record<Role, ClientAction[]> = {
  super_admin: ["view", "createManual", "convertLead", "edit", "assign"],
  admin: ["view", "createManual", "convertLead", "edit", "assign"],
  manager: ["view", "convertLead", "edit", "assign"],
  agent: ["view", "edit"],
  hr: [],
  accountant: ["view"],
};

export function canDoClient(actor: Pick<Actor, "role">, action: ClientAction) {
  return ROLE_ACTIONS[actor.role].includes(action);
}

export function assertCanClient(actor: Pick<Actor, "role">, action: ClientAction) {
  if (!canDoClient(actor, action)) throw forbidden();
}

/** Whether the actor may see/act on a client with the given owner (`teamMemberIds` = managed teams' members). */
export function canAccessClient(actor: Pick<Actor, "id" | "role">, ownerId: string | null, teamMemberIds: readonly string[] = []) {
  switch (clientScope(actor.role)) {
    case "all":
      return true;
    case "team":
      return ownerId !== null && (ownerId === actor.id || teamMemberIds.includes(ownerId));
    case "own":
      return ownerId === actor.id;
    default:
      return false;
  }
}
