import { z } from "zod";
import {
  FOLLOW_UP_WINDOWS,
  LEAD_STAGES,
  LEAD_VIEWS,
  PRIORITIES,
  SORTABLE_COLUMNS,
} from "./constants";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const optionalUuid = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.uuid("Invalid selection").optional());

export const leadFieldsSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  phoneCountryCode: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{0,3}$/, "Invalid country code"),
  phoneNumber: z.string().trim().min(6, "Phone number is required").max(25),
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(z.email("Enter a valid email").optional()),
  cityId: optionalUuid,
  gender: optionalText(30),
  sourceId: z.uuid("Source is required"),
  budgetRangeId: optionalUuid,
  desiredSize: optionalText(40),
  priority: z.enum(PRIORITIES).default("none"),
});

export const createLeadSchema = leadFieldsSchema.extend({
  projectId: z.uuid("Project is required"),
  ownerId: optionalUuid,
  note: optionalText(4000),
  /** How to resolve a phone number that already exists in the project. */
  onDuplicate: z.enum(["reject", "duplicate", "regenerate"]).default("reject"),
});
export type CreateLeadInput = z.input<typeof createLeadSchema>;

// No priority default on update: a partial edit that omits it must not reset it to "none".
export const updateLeadSchema = leadFieldsSchema.extend({ priority: z.enum(PRIORITIES) }).partial();
export type UpdateLeadInput = z.input<typeof updateLeadSchema>;

export const stageChangeSchema = z.object({ stage: z.enum(LEAD_STAGES) });
export const assignSchema = z.object({ ownerId: z.uuid("Choose an owner") });
export const noteSchema = z.object({ body: z.string().trim().min(1, "Write a note").max(4000) });
export const reviewSchema = z.object({ body: z.string().trim().min(1, "Write a review").max(4000) });
export const followUpSchema = z.object({
  dueAt: z.coerce.date({ error: "Pick a date and time" }),
  note: optionalText(1000),
});
export const lostSchema = z.object({
  lostReasonId: z.uuid("Choose a lost reason"),
  note: optionalText(1000),
});
export const decisionSchema = z.object({
  approve: z.boolean(),
  comment: optionalText(1000),
});

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(",")).filter(Boolean)))
    .pipe(z.array(z.enum(values)));

const csvIds = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(",")).filter(Boolean)))
  .pipe(z.array(z.uuid()));

const dateParam = z
  .string()
  .optional()
  .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined));

/** List query parsed from URL search params. Invalid values fall back to defaults. */
export const leadListQuerySchema = z.object({
  view: z.enum(LEAD_VIEWS).catch("all"),
  q: z.string().trim().max(100).optional().catch(undefined),
  stage: csv(LEAD_STAGES).catch([]),
  source: csvIds.catch([]),
  city: csvIds.catch([]),
  /** Lost reason ids (dashboard "Lost leads by reason" click-through). */
  lostReason: csvIds.catch([]),
  priority: csv(PRIORITIES).catch([]),
  followUp: z.enum(FOLLOW_UP_WINDOWS).optional().catch(undefined),
  dateField: z.enum(["created", "updated"]).catch("created"),
  from: dateParam.catch(undefined),
  to: dateParam.catch(undefined),
  /** Exact window and team from a dashboard tile (FR-010): rolling ranges start mid-day. */
  createdFrom: z.iso.datetime().optional().catch(undefined),
  createdTo: z.iso.datetime().optional().catch(undefined),
  team: z.uuid().optional().catch(undefined),
  sort: z.enum(SORTABLE_COLUMNS).catch("createdAt"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type LeadListQuery = z.output<typeof leadListQuerySchema>;

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
