import { AppError } from "@/server/errors";
import type { LeadStage } from "./constants";

export const OPEN_BOOKING_STAGE: LeadStage = "booking_in_process";
export const OPEN_BOOKING_MESSAGE = "This lead has an open booking, so its stage follows the booking. Cancel the booking first (this releases the unit), or confirm it.";

/**
 * Stage-change rules (LEADS_MODULE_PLAN.md Q3):
 * - any stage may move to any other stage, like the reference's "Select target stage";
 * - Lost must go through the lost flow (reason + approval for agents);
 * - Booked is reserved for the Bookings module, and booked leads cannot be moved here;
 * - while the lead has an open booking its stage follows the booking: the only move allowed here is
 *   back to Booking in Process (repairs a lead moved away before this rule existed).
 */
export function assertStageChange(from: LeadStage, to: LeadStage, openBooking = false) {
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
  if (openBooking && to !== OPEN_BOOKING_STAGE) {
    throw new AppError("BUSINESS_RULE", OPEN_BOOKING_MESSAGE);
  }
}
