import { ROLES, type Actor, type Role } from "@/server/auth/types";
import { AppError, forbidden } from "@/server/errors";

/**
 * CRM account management (questionnaire Q2: "Admin and super admin"). Pending clarification C-1,
 * only a Super Admin may create, change, reset or deactivate a Super Admin account or grant that
 * role, so an Admin can never remove the owner's access.
 */
export function canManageAccounts(actor: Pick<Actor, "role">) {
  return actor.role === "super_admin" || actor.role === "admin";
}

export function assertCanManageAccounts(actor: Pick<Actor, "role">) {
  if (!canManageAccounts(actor)) throw forbidden();
}

/** Whether the actor may act on an account with `targetRole` (and, for role changes, grant `nextRole`). */
export function canManageAccount(actor: Pick<Actor, "role">, targetRole: Role, nextRole: Role = targetRole) {
  if (!canManageAccounts(actor)) return false;
  if (actor.role === "super_admin") return true;
  return targetRole !== "super_admin" && nextRole !== "super_admin";
}

export function assertCanManageAccount(actor: Pick<Actor, "role">, targetRole: Role, nextRole: Role = targetRole) {
  if (!canManageAccounts(actor)) throw forbidden();
  if (!canManageAccount(actor, targetRole, nextRole)) throw forbidden("Only a Super Admin can manage Super Admin accounts.");
}

/** Users may not change their own role or status: that is how admins lock themselves out. */
export function assertNotSelf(actor: Pick<Actor, "id">, userId: string, what: string) {
  if (actor.id === userId) throw new AppError("BUSINESS_RULE", `You cannot ${what} your own account.`);
}

/** Roles the actor may grant when creating or changing an account. */
export function grantableRoles(actor: Pick<Actor, "role">): Role[] {
  if (!canManageAccounts(actor)) return [];
  return ROLES.filter((r) => actor.role === "super_admin" || r !== "super_admin");
}
