/** FR-082 stages in reference order. Cancelled is reachable from any open stage. */
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
  token_pending: "Token pending",
  token_received: "Token received",
  provisional_receipt: "Provisional receipt",
  sales_order: "Sales order",
  booking_form: "Booking form",
  down_payment: "Down payment",
  agreement_pending: "Agreement pending",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

/** The forward path (decision 29 Oct 2026: one step at a time, no skipping, no going back). */
export const FORWARD_PATH: BookingStage[] = BOOKING_STAGES.filter((s) => s !== "cancelled");

export const CLOSED_STAGES: BookingStage[] = ["confirmed", "cancelled"];

/** Highest stage an agent may move a booking to (permission matrix: "O (up to Sales order)"). */
export const AGENT_MAX_STAGE: BookingStage = "sales_order";

/** Stages during which the unit is only "held" for the token (used for the overdue-hold flag). */
export const HOLD_STAGES: BookingStage[] = ["negotiation", "token_pending"];

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
