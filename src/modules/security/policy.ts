import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/** Security settings (sign-in log retention): super admin and admin only (D2). */
export function canManageSecurity(actor: Pick<Actor, "role">) {
  return actor.role === "super_admin" || actor.role === "admin";
}

export function assertCanManageSecurity(actor: Pick<Actor, "role">) {
  if (!canManageSecurity(actor)) throw forbidden();
}
