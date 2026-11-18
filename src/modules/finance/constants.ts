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

/**
 * Finance setting keys. Receipt / reversal prefixes default to empty. The booking prefix and the
 * payment terms (owner, 18 Nov 2026: the Super Admin edits them) default to the values below when empty.
 */
export const SETTING_KEYS = ["receipt_prefix", "reversal_prefix", "booking_prefix", "installment_grace_days", "down_payment_due_days", "down_payment_grace_days"] as const;
/** The client's format, MZ-0001 (owner confirmed 18 Nov 2026); the Super Admin can change it in Finance settings. */
export const DEFAULT_BOOKING_PREFIX = "MZ-";
/** A booking number is padded to at least this many digits: MZ-0012. */
export const BOOKING_REF_DIGITS = 4;
/** "MZ-0012", or null for a booking without a number. */
export function bookingRef(prefix: string | null | undefined, refNo: number | null | undefined) {
  if (refNo === null || refNo === undefined) return null;
  return `${prefix || DEFAULT_BOOKING_PREFIX}${String(refNo).padStart(BOOKING_REF_DIGITS, "0")}`;
}
export type SettingKey = (typeof SETTING_KEYS)[number];

/**
 * When an unpaid amount becomes overdue (client confirmations, 10 Nov 2026). These are the defaults;
 * since 18 Nov 2026 the Super Admin can change them in Finance → Settings (`paymentTerms`).
 * - Installments are due on the 10th; after 5 days' grace they are overdue from the 16th.
 * - The down payment is due 7 days after the booking, plus 3 days' grace.
 */
export const INSTALLMENT_GRACE_DAYS = 5;
export const DOWN_PAYMENT_DUE_DAYS = 7;
export const DOWN_PAYMENT_GRACE_DAYS = 3;
export const MAX_TERM_DAYS = 90;

export type PaymentTerms = { installmentGraceDays: number; downPaymentDueDays: number; downPaymentGraceDays: number };

/** The payment terms in force: the saved settings, or the defaults when a setting is empty. */
export function paymentTerms(settings: Partial<Record<SettingKey, string>>): PaymentTerms {
  const num = (v: string | undefined, fallback: number) => (v !== undefined && /^\d{1,3}$/.test(v) && Number(v) <= MAX_TERM_DAYS ? Number(v) : fallback);
  return {
    installmentGraceDays: num(settings.installment_grace_days, INSTALLMENT_GRACE_DAYS),
    downPaymentDueDays: num(settings.down_payment_due_days, DOWN_PAYMENT_DUE_DAYS),
    downPaymentGraceDays: num(settings.down_payment_grace_days, DOWN_PAYMENT_GRACE_DAYS),
  };
}

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
