import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Holidays authorization (USER_ROLES_AND_PERMISSIONS.md "HR employees / holidays": F/F/R/—/F/—).
 * Agents and accountants get Access denied on the Holidays page, as observed in the reference (B-07).
 */
export function canViewHolidays(actor: Pick<Actor, "role">) {
  return canManageHolidays(actor) || actor.role === "manager";
}

export function canManageHolidays(actor: Pick<Actor, "role">) {
  return actor.role === "super_admin" || actor.role === "admin" || actor.role === "hr";
}

export function assertCanViewHolidays(actor: Pick<Actor, "role">) {
  if (!canViewHolidays(actor)) throw forbidden();
}

export function assertCanManageHolidays(actor: Pick<Actor, "role">) {
  if (!canManageHolidays(actor)) throw forbidden();
}
