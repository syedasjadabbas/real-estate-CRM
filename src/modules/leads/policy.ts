import type { Actor, Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Leads authorization (USER_ROLES_AND_PERMISSIONS.md, LEADS_MODULE_PLAN.md §6).
 * Pure functions; the service resolves team membership and passes it in.
 */
export type LeadScope = "all" | "team" | "own" | "none";

export function leadScope(role: Role): LeadScope {
  switch (role) {
    case "super_admin":
    case "admin":
      return "all";
    case "manager":
      return "team";
    case "agent":
      return "own";
    default:
      return "none";
  }
}

export type LeadAction =
  | "view"
  | "create"
  | "edit"
  | "assign"
  | "markLostDirect"
  | "requestLost"
  | "decideLost"
  | "review";

const ROLE_ACTIONS: Record<Role, LeadAction[]> = {
  super_admin: ["view", "create", "edit", "assign", "markLostDirect", "decideLost", "review"],
  admin: ["view", "create", "edit", "assign", "markLostDirect", "decideLost", "review"],
  manager: ["view", "create", "edit", "assign", "markLostDirect", "decideLost", "review"],
  agent: ["view", "create", "edit", "requestLost"],
  hr: [],
  accountant: [],
};

export function canDo(actor: Pick<Actor, "role">, action: LeadAction) {
  return ROLE_ACTIONS[actor.role].includes(action);
}

export function assertCan(actor: Pick<Actor, "role">, action: LeadAction) {
  if (!canDo(actor, action)) throw forbidden();
}

/**
 * Whether the actor may see/act on a lead with the given owner.
 * `teamMemberIds` = users in teams the actor manages (manager scope only).
 */
export function canAccessLead(
  actor: Pick<Actor, "id" | "role">,
  ownerId: string | null,
  teamMemberIds: readonly string[] = [],
) {
  switch (leadScope(actor.role)) {
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

/** Whether the actor may make `assigneeId` the owner of a lead. */
export function canAssignTo(
  actor: Pick<Actor, "id" | "role">,
  assigneeId: string,
  teamMemberIds: readonly string[] = [],
) {
  const scope = leadScope(actor.role);
  if (scope === "all") return true;
  if (scope === "team") return assigneeId === actor.id || teamMemberIds.includes(assigneeId);
  return false;
}
