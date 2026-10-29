import type { Actor, Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { AGENT_MAX_STAGE, FORWARD_PATH, type BookingStage } from "./constants";

/**
 * Bookings authorization: the PROPOSED matrix in USER_ROLES_AND_PERMISSIONS.md, approved 29 Oct 2026.
 *   create F/F/T/O/—/—  ·  change stage F/F/T/O (up to Sales order)/—/R  ·  confirm / cancel F/F/T/—/—/—
 * Record scope follows the booking's sales agent (own / team / all); accountants read everything.
 */
export type BookingScope = "all" | "team" | "own" | "none";

export function bookingScope(role: Role): BookingScope {
  switch (role) {
    case "super_admin":
    case "admin":
    case "accountant":
      return "all";
    case "manager":
      return "team";
    case "agent":
      return "own";
    default:
      return "none";
  }
}

export type BookingAction = "view" | "create" | "advance" | "confirm" | "cancel" | "editDetails";

const ROLE_ACTIONS: Record<Role, BookingAction[]> = {
  super_admin: ["view", "create", "advance", "confirm", "cancel", "editDetails"],
  admin: ["view", "create", "advance", "confirm", "cancel", "editDetails"],
  manager: ["view", "create", "advance", "confirm", "cancel", "editDetails"],
  agent: ["view", "create", "advance"],
  hr: [],
  accountant: ["view"],
};

export function canDoBooking(actor: Pick<Actor, "role">, action: BookingAction) {
  return ROLE_ACTIONS[actor.role].includes(action);
}

export function assertCanBooking(actor: Pick<Actor, "role">, action: BookingAction) {
  if (!canDoBooking(actor, action)) throw forbidden();
}

export function canAccessBooking(actor: Pick<Actor, "id" | "role">, agentId: string | null, teamMemberIds: readonly string[] = []) {
  switch (bookingScope(actor.role)) {
    case "all":
      return true;
    case "team":
      return agentId !== null && (agentId === actor.id || teamMemberIds.includes(agentId));
    case "own":
      return agentId === actor.id;
    default:
      return false;
  }
}

/** Whether the actor may move a booking forward to `target` (confirm has its own permission). */
export function canMoveTo(actor: Pick<Actor, "role">, target: BookingStage) {
  if (target === "cancelled") return canDoBooking(actor, "cancel");
  if (target === "confirmed") return canDoBooking(actor, "confirm");
  if (!canDoBooking(actor, "advance")) return false;
  if (actor.role === "agent") return FORWARD_PATH.indexOf(target) <= FORWARD_PATH.indexOf(AGENT_MAX_STAGE);
  return true;
}
