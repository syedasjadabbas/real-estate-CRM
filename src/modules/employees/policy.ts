import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Employee records (USER_ROLES_AND_PERMISSIONS.md "HR employees / holidays": F/F/R/—/F/—).
 * Only the HR profile fields are editable here; account data (name, email, role, status) is
 * read-only until account management is decided (HR plan Q2).
 */
export function canViewEmployees(actor: Pick<Actor, "role">) {
  return canEditEmployeeProfiles(actor) || actor.role === "manager";
}

export function canEditEmployeeProfiles(actor: Pick<Actor, "role">) {
  return actor.role === "super_admin" || actor.role === "admin" || actor.role === "hr";
}

export function assertCanViewEmployees(actor: Pick<Actor, "role">) {
  if (!canViewEmployees(actor)) throw forbidden();
}

export function assertCanEditEmployeeProfiles(actor: Pick<Actor, "role">) {
  if (!canEditEmployeeProfiles(actor)) throw forbidden();
}
