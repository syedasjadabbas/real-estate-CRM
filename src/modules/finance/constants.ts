/** Payment types from DATA_MODEL.md §9 / FR-202 (token, down payment, installment) plus "other". */
export const PAYMENT_TYPES = ["token", "down_payment", "installment", "other"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  token: "Token",
  down_payment: "Down payment",
  installment: "Installment",
  other: "Other",
};

/** Booking stages that accept payments: Token pending onward (proposed Q-F11 default); never Negotiation or Cancelled. */
export const PAYABLE_STAGES = [
  "token_pending",
  "token_received",
  "provisional_receipt",
  "sales_order",
  "booking_form",
  "down_payment",
  "agreement_pending",
  "confirmed",
] as const;

/** Finance setting keys. Values default to empty: the receipt format is pending client confirmation (Q-F3). */
export const SETTING_KEYS = ["receipt_prefix", "reversal_prefix"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const PAYMENT_PAGE_SIZE = 50;
export const OUTSTANDING_PAGE_SIZE = 50;

/** Sortable columns (FR-005). */
export const PAYMENT_SORT_COLUMNS = ["ref", "receivedOn", "lead", "unit", "project", "type", "method", "amount", "status", "recorded"] as const;
export type PaymentSortColumn = (typeof PAYMENT_SORT_COLUMNS)[number];
export const OUTSTANDING_SORT_COLUMNS = ["lead", "unit", "project", "agent", "stage", "total", "paid", "outstanding", "due", "overdue", "milestone"] as const;
export type OutstandingSortColumn = (typeof OUTSTANDING_SORT_COLUMNS)[number];
export const ENTRY_SORT_COLUMNS = ["date", "kind", "category", "payee", "amount"] as const;
export type EntrySortColumn = (typeof ENTRY_SORT_COLUMNS)[number];
