/**
 * Every value the database may hold. Since 14 Nov 2026 (owner's decision) bookings use four stages:
 * Token → Partial Down Payment → Complete Down Payment → Closed Won, plus Cancelled. They are stored as
 * token_pending, down_payment, agreement_pending and confirmed; the other values are no longer used
 * (existing bookings were moved to Token) and stay only so old history entries keep a label.
 */
export const BOOKING_STAGES = [
  "negotiation",
  "token_pending",
  "token_received",
  "provisional_receipt",
  "sales_order",
  "booking_form",
  "down_payment",
  "agreement_pending",
  "confirmed",
  "cancelled",
] as const;
export type BookingStage = (typeof BOOKING_STAGES)[number];

export const BOOKING_STAGE_LABELS: Record<BookingStage, string> = {
  negotiation: "Negotiation",
  token_pending: "Token",
  token_received: "Token received",
  provisional_receipt: "Provisional receipt",
  sales_order: "Sales order",
  booking_form: "Booking form",
  down_payment: "Partial Down Payment",
  agreement_pending: "Complete Down Payment",
  confirmed: "Closed Won",
  cancelled: "Cancelled",
};

/** The forward path, one step at a time, no skipping, no going back (stages of 14 Nov 2026). */
export const FORWARD_PATH: BookingStage[] = ["token_pending", "down_payment", "agreement_pending", "confirmed"];

/** Stages offered in filters and shown to users, in order. */
export const CURRENT_STAGES: BookingStage[] = [...FORWARD_PATH, "cancelled"];

/** Where a new booking starts. */
export const FIRST_STAGE: BookingStage = "token_pending";

export const CLOSED_STAGES: BookingStage[] = ["confirmed", "cancelled"];

/** Highest stage an agent may move a booking to: Complete Down Payment. Closed Won is for managers and admins. */
export const AGENT_MAX_STAGE: BookingStage = "agreement_pending";

/**
 * Stages during which the unit is only "held" for the token: the token has not been received yet
 * (Token received and later stages mean it has). Used for the overdue flag and FR-081 auto-release.
 */
export const HOLD_STAGES: BookingStage[] = ["negotiation", "token_pending"];
// Token covers both "token awaited" and "token paid": the release job only frees a hold with no
// payment recorded at all (hold-release.ts), so a paid token keeps the unit.

/** FR-081 (client confirmation, 10 Nov 2026): a hold expires after 7 days and the unit returns to Available. */
export const HOLD_DAYS = 7;

/** Cancellation reason (and stage-history note) written when the release job frees an expired hold. */
export const HOLD_EXPIRED_REASON = "Hold expired";

export const PAYMENT_DOCS_STATUSES = ["not_submitted", "submitted", "verified"] as const;
export type PaymentDocsStatus = (typeof PAYMENT_DOCS_STATUSES)[number];

export const PAYMENT_DOCS_LABELS: Record<PaymentDocsStatus, string> = {
  not_submitted: "Not submitted",
  submitted: "Submitted",
  verified: "Verified",
};

/** FR-083: the milestone is met when paid ≥ 30% of the total. */
export const MILESTONE_RATIO = 0.3;

export const BOOKING_PAGE_SIZE = 50;

/** The stage after `stage` on the forward path, or null at the end / when closed. */
export function nextStage(stage: BookingStage): BookingStage | null {
  if (CLOSED_STAGES.includes(stage)) return null;
  return FORWARD_PATH[FORWARD_PATH.indexOf(stage) + 1] ?? null;
}
