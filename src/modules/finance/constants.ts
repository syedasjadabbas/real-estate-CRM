/** Payment types from DATA_MODEL.md §9 / FR-202 (token, down payment, installment) plus "other". */
export const PAYMENT_TYPES = ["token", "down_payment", "installment", "other"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  token: "Token",
  down_payment: "Down payment",
  installment: "Installment",
  other: "Other",
};

/** Booking stages that accept payments: every stage from Token to Closed Won; never Cancelled. */
export const PAYABLE_STAGES = ["token_pending", "down_payment", "agreement_pending", "confirmed"] as const;

/** Finance setting keys. Values default to empty: the receipt format is pending client confirmation (Q-F3). */
export const SETTING_KEYS = ["receipt_prefix", "reversal_prefix"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/**
 * When an unpaid amount becomes overdue (client confirmations, 10 Nov 2026). The client marked the
 * grace periods "to be confirmed", so they live here, in one place.
 * - Installments are due on the 10th; after 5 days' grace they are overdue from the 16th.
 * - The down payment is due 7 days after the booking, plus 3 days' grace.
 */
export const INSTALLMENT_GRACE_DAYS = 5;
export const DOWN_PAYMENT_DUE_DAYS = 7;
export const DOWN_PAYMENT_GRACE_DAYS = 3;

/** Aging of the oldest overdue amount, in days past the end of its grace period. */
export const AGING_BUCKETS = [
  { key: "1-15", label: "1–15 days", min: 1, max: 15 },
  { key: "16-30", label: "16–30 days", min: 16, max: 30 },
  { key: "31-60", label: "31–60 days", min: 31, max: 60 },
  { key: "60+", label: "60+ days", min: 61, max: Infinity },
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number]["key"];

/** Days → aging bucket; null when nothing is overdue. */
export function agingBucket(daysOverdue: number | null): AgingBucket | null {
  if (daysOverdue === null || daysOverdue < 1) return null;
  return AGING_BUCKETS.find((b) => daysOverdue >= b.min && daysOverdue <= b.max)!.key;
}

/** YYYY-MM-DD plus n days (calendar dates, no time zone involved). */
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const PAYMENT_PAGE_SIZE = 50;
export const OUTSTANDING_PAGE_SIZE = 50;

/** Sortable columns (FR-005). */
export const PAYMENT_SORT_COLUMNS = ["ref", "receivedOn", "lead", "unit", "project", "type", "method", "amount", "status", "recorded"] as const;
export type PaymentSortColumn = (typeof PAYMENT_SORT_COLUMNS)[number];
export const OUTSTANDING_SORT_COLUMNS = ["lead", "unit", "project", "agent", "stage", "total", "paid", "outstanding", "due", "overdue", "milestone"] as const;
export type OutstandingSortColumn = (typeof OUTSTANDING_SORT_COLUMNS)[number];
export const ENTRY_SORT_COLUMNS = ["date", "kind", "category", "payee", "amount"] as const;
export type EntrySortColumn = (typeof ENTRY_SORT_COLUMNS)[number];
