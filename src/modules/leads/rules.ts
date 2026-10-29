import { AppError } from "@/server/errors";
import type { LeadStage } from "./constants";

/**
 * Stage-change rules (LEADS_MODULE_PLAN.md Q3):
 * - any stage may move to any other stage, like the reference's "Select target stage";
 * - Lost must go through the lost flow (reason + approval for agents);
 * - Booked is reserved for the Bookings module, and booked leads cannot be moved here.
 */
export function assertStageChange(from: LeadStage, to: LeadStage) {
  if (from === to) {
    throw new AppError("BUSINESS_RULE", "The lead is already in that stage.");
  }
  if (to === "lost_lead") {
    throw new AppError("BUSINESS_RULE", "Use “Mark lost” so a lost reason is recorded.");
  }
  if (to === "booked") {
    throw new AppError("BUSINESS_RULE", "Leads become Booked when a booking is confirmed in the Bookings module.");
  }
  if (from === "booked") {
    throw new AppError("BUSINESS_RULE", "Booked leads are managed from their booking.");
  }
}

/** Round-robin: the eligible user after `lastUserId`, wrapping around. */
export function pickNextAssignee(eligibleIds: string[], lastUserId: string | null): string | null {
  if (eligibleIds.length === 0) return null;
  const index = lastUserId ? eligibleIds.indexOf(lastUserId) : -1;
  return eligibleIds[(index + 1) % eligibleIds.length];
}
