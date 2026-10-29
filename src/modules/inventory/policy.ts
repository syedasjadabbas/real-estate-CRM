import type { Actor, Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Inventory authorization (USER_ROLES_AND_PERMISSIONS.md): view F/F/R/R/—/R,
 * edit / import F/F/—/—/—/—. Units are company-wide, so there is no record scope.
 * Manual status changes are an admin override until Bookings drives status (decision 29 Oct 2026).
 */
export type InventoryAction = "view" | "manage";

const ROLE_ACTIONS: Record<Role, InventoryAction[]> = {
  super_admin: ["view", "manage"],
  admin: ["view", "manage"],
  manager: ["view"],
  agent: ["view"],
  hr: [],
  accountant: ["view"],
};

export function canDoInventory(actor: Pick<Actor, "role">, action: InventoryAction) {
  return ROLE_ACTIONS[actor.role].includes(action);
}

export function assertCanInventory(actor: Pick<Actor, "role">, action: InventoryAction) {
  if (!canDoInventory(actor, action)) throw forbidden();
}
