import type { Actor, Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Inventory authorization: view F/F/R/R/—/R. Adding, editing and importing units is the Super Admin's
 * alone (owner, 15 Nov 2026); Admins see everything read-only. Units are company-wide, so there is no record scope.
 * Manual status changes are an admin override until Bookings drives status (decision 29 Oct 2026).
 */
export type InventoryAction = "view" | "manage";

const ROLE_ACTIONS: Record<Role, InventoryAction[]> = {
  super_admin: ["view", "manage"],
  admin: ["view"],
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
