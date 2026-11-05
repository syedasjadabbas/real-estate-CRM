import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/** The managed city list (S-22, FR-042): super admins and admins. */
export function canManageCities(actor: Pick<Actor, "role">) {
  return actor.role === "super_admin" || actor.role === "admin";
}

export function assertCanManageCities(actor: Pick<Actor, "role">) {
  if (!canManageCities(actor)) throw forbidden();
}
