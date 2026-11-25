import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";

/**
 * Owner's rules of 14 Nov 2026 for agents editing a customer (lead or client):
 * - an agent can never change a phone number (primary or extra); an Admin does that;
 * - a name an agent changes waits for an Admin to approve it (client, 25 Nov 2026; before, Admins were only told).
 */
export const AGENT_PHONE_MESSAGE = "Agents can't change phone numbers. Ask an Admin if a number is wrong.";

export function assertPhoneEditable(actor: Pick<Actor, "role">, phoneEdited: boolean) {
  if (actor.role === "agent" && phoneEdited) {
    throw new AppError("FORBIDDEN", AGENT_PHONE_MESSAGE, { fields: { phoneNumber: AGENT_PHONE_MESSAGE } });
  }
}
