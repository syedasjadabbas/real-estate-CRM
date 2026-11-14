import { z } from "zod";
import { BOOKING_STAGES, PAYMENT_DOCS_STATUSES } from "./constants";

const money = (label: string, max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(/,/g, ""))) : v),
    z
      .number(`${label} is required`)
      .refine((n) => Number.isFinite(n), `${label} must be a number`)
      .refine((n) => n > 0, `${label} must be greater than 0`)
      .refine((n) => n <= max, `${label} is too large`)
      // Tolerance absorbs binary rounding (12.34 * 100 = 1233.9999…).
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use at most 2 decimals"),
  );

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.iso.date("Use a valid date").optional());

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));

/** FR-080 new-booking fields as observed: project, lead, available unit, rate, token, payment instructions; plus the hold date (Q-B2 decision). */
export const createBookingSchema = z.object({
  projectId: z.uuid("Choose a project"),
  leadId: z.uuid("Choose a lead"),
  unitId: z.uuid("Choose an available unit"),
  /** Optional since 14 Nov 2026: without it the unit's inventory rate, less `discountPct`, is used. */
  ratePerSqft: money("Per sq ft rate", 10_000_000).optional(),
  /** Discount on the unit's inventory price, within the role's cap (agents 5%, Admins any). */
  discountPct: z.coerce.number("Enter a discount %").min(0, "Use 0 to 100").max(100, "Use 0 to 100").optional(),
  tokenAmount: money("Token amount", 1e12),
  reservedUntil: optionalDate,
  paymentInstructions: optionalText(2000),
});
export type CreateBookingInput = z.input<typeof createBookingSchema>;

export const advanceSchema = z.object({
  toStage: z.enum(BOOKING_STAGES, "Choose a stage"),
  note: optionalText(1000),
  /** The payment proof attached with this move (required for Partial Down Payment, 14 Nov 2026). */
  proofFileId: z.uuid().optional().nullable(),
  /** The amount received for this payment (down payment moves), declared with its proof; Accounts posts it. */
  amount: z.coerce.number("Enter the amount received").positive("Enter the amount received").max(1e12).optional().nullable(),
});

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(1000),
});

/** Overview fields that may change after creation. Rate and token are fixed (cancel and rebook to change them). */
export const updateBookingSchema = z
  .object({
    reservedUntil: optionalDate,
    paymentInstructions: optionalText(2000),
    agreementSentOn: optionalDate,
    paymentDocsStatus: z.enum(PAYMENT_DOCS_STATUSES, "Choose a status"),
  })
  .partial();

/** FR-005 column sorting on the Bookings list; newest change first by default. */
export const BOOKING_SORT_COLUMNS = ["lead", "agent", "unit", "project", "stage", "paid", "updatedAt"] as const;
export type BookingSortColumn = (typeof BOOKING_SORT_COLUMNS)[number];

export const bookingListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  project: z.union([z.literal("all"), z.uuid()]).optional().catch(undefined),
  stage: z.enum(BOOKING_STAGES).optional().catch(undefined),
  sort: z.enum(BOOKING_SORT_COLUMNS).catch("updatedAt"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type BookingListQuery = z.output<typeof bookingListQuerySchema>;
