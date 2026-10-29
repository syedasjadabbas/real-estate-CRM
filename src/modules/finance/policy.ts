import type { Actor, Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Finance authorization: matrix "Accounts & Finance F/R/—/—/—/F" plus the proposed Q-F2 defaults
 * (29 Oct 2026): accountants record payments and request reversals; managers (own team's bookings)
 * and admins approve them; super admins keep audited emergency control (they may approve their own
 * request; the audit marks it). Nothing can edit or delete a posted payment.
 */
export type FinanceAction = "viewAll" | "record" | "requestReversal" | "decideReversal" | "settings";

const ROLE_ACTIONS: Record<Role, FinanceAction[]> = {
  super_admin: ["viewAll", "record", "requestReversal", "decideReversal", "settings"],
  admin: ["viewAll", "decideReversal"],
  manager: ["decideReversal"],
  agent: [],
  hr: [],
  accountant: ["viewAll", "record", "requestReversal"],
};

export function canDoFinance(actor: Pick<Actor, "role">, action: FinanceAction) {
  return ROLE_ACTIONS[actor.role].includes(action);
}

export function assertCanFinance(actor: Pick<Actor, "role">, action: FinanceAction) {
  if (!canDoFinance(actor, action)) throw forbidden();
}

/**
 * Itemised payments on a booking: finance roles see all; a manager sees them for bookings in their
 * team (needed to approve reversals). Agents see only the booking's Paid total (Q-F8 open).
 */
export function canSeeItemisedPayments(actor: Pick<Actor, "role">) {
  return canDoFinance(actor, "viewAll") || actor.role === "manager";
}
