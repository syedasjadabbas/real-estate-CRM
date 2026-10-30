import { z } from "zod";
import { TARGET_PERIODS } from "./period";

const whole = (label: string) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? 0 : typeof v === "string" ? Number(v.replace(/,/g, "")) : v),
    z.number(`${label} must be a number`).int(`${label}: use a whole number`).min(0, `${label} can't be negative`).max(1_000_000, `${label} is too large`),
  );

const sqft = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? 0 : typeof v === "string" ? Number(v.replace(/,/g, "")) : v),
  z
    .number("Sold sq ft must be a number")
    .refine((n) => Number.isFinite(n) && n >= 0, "Sold sq ft can't be negative")
    .refine((n) => n <= 10_000_000, "Sold sq ft is too large")
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use at most 2 decimals"),
);

/** FR-110: one target per agent per period; the anchor date is normalised to the period start. */
export const setTargetSchema = z.object({
  userId: z.uuid("Choose an agent"),
  period: z.enum(TARGET_PERIODS, "Choose a period"),
  anchor: z.iso.date("Use a valid date"),
  calls: whole("Calls"),
  meetings: whole("Meetings"),
  soldSqft: sqft,
});

export const targetQuerySchema = z.object({
  period: z.enum(TARGET_PERIODS).catch("monthly"),
  anchor: z.iso.date().optional().catch(undefined),
});
