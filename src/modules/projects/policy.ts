import type { Actor, Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Projects authorization (USER_ROLES_AND_PERMISSIONS.md): view F/F/R/R/—/R,
 * create / edit F/F/—/—/—/—. Projects are company-wide, so there is no record scope.
 */
export type ProjectAction = "view" | "manage";

const ROLE_ACTIONS: Record<Role, ProjectAction[]> = {
  super_admin: ["view", "manage"],
  admin: ["view", "manage"],
  manager: ["view"],
  agent: ["view"],
  hr: [],
  accountant: ["view"],
};

export function canDoProject(actor: Pick<Actor, "role">, action: ProjectAction) {
  return ROLE_ACTIONS[actor.role].includes(action);
}

export function assertCanProject(actor: Pick<Actor, "role">, action: ProjectAction) {
  if (!canDoProject(actor, action)) throw forbidden();
}

/** FR-060: inactive projects are hidden from the project selector except for admins (decision 29 Oct 2026). */
export function seesInactiveInSelector(actor: Pick<Actor, "role">) {
  return canDoProject(actor, "manage");
}
