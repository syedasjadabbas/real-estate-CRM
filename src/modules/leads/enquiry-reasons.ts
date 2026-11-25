/** Why a customer asks again (client, 25 Nov 2026). Safe for client components. */
export const ENQUIRY_REASONS = [
  "Price or payment plan",
  "Availability",
  "Wants a different size or unit",
  "Site visit",
  "Ready to book",
  "Comparing with another project",
  "Didn't get a reply",
] as const;
/** Chosen when none fits; the reason is then typed. */
export const OTHER_REASON = "other";
