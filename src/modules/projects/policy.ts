import type { Actor, Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Projects authorization: view F/F/R/R/—/R. Adding and editing projects is the Super Admin's alone
 * (owner, 15 Nov 2026); Admins see everything read-only. Projects are company-wide, so there is no record scope.
 */
export type ProjectAction = "view" | "manage";

const ROLE_ACTIONS: Record<Role, ProjectAction[]> = {
  super_admin: ["view", "manage"],
  admin: ["view"],
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
  return actor.role === "super_admin" || actor.role === "admin";
}
