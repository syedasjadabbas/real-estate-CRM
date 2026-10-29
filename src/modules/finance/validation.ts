import { z } from "zod";
import { PAYMENT_TYPES } from "./constants";

const amount = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(/,/g, ""))) : v),
  z
    .number("Amount is required")
    .refine((n) => Number.isFinite(n), "Amount must be a number")
    .refine((n) => n > 0, "Amount must be greater than 0")
    .refine((n) => n <= 1e12, "Amount is too large")
    // Tolerance absorbs binary rounding (12.34 * 100 = 1233.9999…).
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use at most 2 decimals"),
);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const recordPaymentSchema = z.object({
  bookingId: z.uuid("Choose a booking"),
  type: z.enum(PAYMENT_TYPES, "Choose a payment type"),
  amount,
  receivedOn: z.iso.date("Use a valid date"),
  methodId: z.uuid("Choose a payment method"),
  reference: optionalText(120),
  note: optionalText(1000),
  /** Client-generated key; a retried submission with the same key returns the first result. */
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

export const reversalRequestSchema = z.object({
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(1000),
});

export const reversalDecisionSchema = z.object({
  approve: z.boolean(),
  note: optionalText(1000),
});

/** Prefixes only (the final receipt format is pending client confirmation, Q-F3). */
export const financeSettingsSchema = z.object({
  receipt_prefix: z
    .string()
    .trim()
    .max(20)
    .regex(/^[A-Za-z0-9\-/ ]*$/, "Use letters, numbers, spaces, - or /")
    .optional(),
  reversal_prefix: z
    .string()
    .trim()
    .max(20)
    .regex(/^[A-Za-z0-9\-/ ]*$/, "Use letters, numbers, spaces, - or /")
    .optional(),
});

export const paymentMethodSchema = z.object({ name: z.string().trim().min(2, "Name is required").max(40) });
