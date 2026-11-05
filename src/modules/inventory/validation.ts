import { z } from "zod";
import { DIMENSION_KEYS, SALE_MODELS, UNIT_STATUSES, UNIT_SORT_COLUMNS } from "./constants";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));

/** Numbers arrive as strings from forms; "" means not provided. */
const amount = (label: string, opts: { positive?: boolean; max: number }) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(/,/g, ""))) : v),
    z
      // Blank is "required"; text that isn't a number (NaN after parsing) says so.
      .number({ error: (issue) => (issue.input === undefined ? `${label} is required` : `${label} must be a number`) })
      .refine((n) => Number.isFinite(n), `${label} must be a number`)
      .refine((n) => (opts.positive ? n > 0 : n >= 0), opts.positive ? `${label} must be greater than 0` : `${label} cannot be negative`)
      .refine((n) => n <= opts.max, `${label} is too large`)
      // Tolerance absorbs binary rounding (12.34 * 100 = 1233.9999…).
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use at most 2 decimals"),
  );

const optionalBedrooms = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v)) : v),
  z.number("Bedrooms must be a whole number").int("Bedrooms must be a whole number").min(0, "Bedrooms cannot be negative").max(50).optional(),
);

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.iso.date("Use a valid date").optional());

/** FR-070 unit fields. Floor, block, category, type and premium are checked against project dimensions in the service. */
export const unitFieldsSchema = z.object({
  unitNo: z.string().trim().min(1, "Unit number is required").max(40, "Use at most 40 characters"),
  floor: optionalText(60),
  block: optionalText(60),
  saleModel: z.enum(SALE_MODELS, "Choose a sale model"),
  areaSqft: amount("Area", { positive: true, max: 1_000_000 }),
  basePrice: amount("Base price", { max: 1e12 }),
  nature: optionalText(60),
  category: optionalText(60),
  type: optionalText(60),
  bedrooms: optionalBedrooms,
  premium: optionalText(60),
  comment: optionalText(2000),
  listedOn: optionalDate,
});

export const createUnitSchema = unitFieldsSchema.extend({
  projectId: z.uuid("Choose a project"),
  saleModel: z.enum(SALE_MODELS, "Choose a sale model").default("whole"),
});
export type CreateUnitInput = z.input<typeof createUnitSchema>;

/** Partial edit: no defaults; empty strings clear optional fields. Status has its own command. */
export const updateUnitSchema = unitFieldsSchema.partial();

export const statusChangeSchema = z.object({
  status: z.enum(UNIT_STATUSES, "Choose a status"),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
});

const dimensionList = z
  .array(z.string().trim().max(60, "Use at most 60 characters per value"))
  .max(200, "Use at most 200 values")
  .transform((list) => {
    const seen = new Set<string>();
    return list.filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
  });

export const dimensionsSchema = z.object(Object.fromEntries(DIMENSION_KEYS.map((k) => [k, dimensionList.optional()])) as Record<
  (typeof DIMENSION_KEYS)[number],
  z.ZodOptional<typeof dimensionList>
>);

/** List query parsed from URL search params. Invalid values fall back to defaults. `project=all` lists every project. */
export const unitListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  project: z.union([z.literal("all"), z.uuid()]).optional().catch(undefined),
  status: z.enum(UNIT_STATUSES).optional().catch(undefined),
  saleModel: z.enum(SALE_MODELS).optional().catch(undefined),
  nature: z.string().trim().max(60).optional().catch(undefined),
  floor: z.string().trim().max(60).optional().catch(undefined),
  block: z.string().trim().max(60).optional().catch(undefined),
  category: z.string().trim().max(60).optional().catch(undefined),
  type: z.string().trim().max(60).optional().catch(undefined),
  premium: z.string().trim().max(60).optional().catch(undefined),
  area: z.coerce.number().positive().max(1_000_000).optional().catch(undefined),
  sort: z.enum(UNIT_SORT_COLUMNS).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type UnitListQuery = z.output<typeof unitListQuerySchema>;
