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
const amount = (label: string) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? 0 : typeof v === "string" ? Number(v.replace(/,/g, "")) : v),
    z.number(`${label} must be a number`).min(0, `${label} can't be negative`).max(1_000_000_000, `${label} is too large`),
  );

/** A goal the CRM can't count, with progress entered by hand (owner, 15 Nov 2026). */
export const customGoalSchema = z.object({
  name: z.string().trim().min(1, "Name the goal").max(60, "Use at most 60 characters"),
  goal: amount("Goal").refine((n) => n > 0, "Set a goal above 0"),
  achieved: amount("Progress"),
});
export type CustomGoalInput = z.output<typeof customGoalSchema>;

export const setTargetSchema = z.object({
  userId: z.uuid("Choose an agent"),
  period: z.enum(TARGET_PERIODS, "Choose a period"),
  anchor: z.iso.date("Use a valid date"),
  /** Last day of a custom period (required when period is "custom"). */
  to: z.iso.date("Use a valid date").optional().nullable(),
  calls: whole("Calls"),
  meetings: whole("Meetings"),
  soldSqft: sqft,
  /** Custom goals; when sent, they replace the target's custom goals (at most 10, names unique). */
  custom: z
    .array(customGoalSchema)
    .max(10, "At most 10 custom goals")
    .refine((goals) => new Set(goals.map((g) => g.name.toLowerCase())).size === goals.length, "Each custom goal needs a different name")
    .optional(),
});

export const targetQuerySchema = z.object({
  period: z.enum(TARGET_PERIODS).catch("monthly"),
  anchor: z.iso.date().optional().catch(undefined),
  /** Last day of a custom period. */
  to: z.iso.date().optional().catch(undefined),
  /** Agent name search and team filter (15 Nov 2026). */
  q: z.string().trim().max(100).optional().catch(undefined),
  team: z.uuid().optional().catch(undefined),
});
