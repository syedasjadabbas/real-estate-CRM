import { z } from "zod";
import { MAX_INSTALLMENTS, TASK_SORT_COLUMNS, TASK_STATUSES, TASK_TYPES } from "./constants";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const optionalId = (message: string) =>
  z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .pipe(z.uuid(message).nullable());

const toNumber = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(/,/g, ""))) : v);

const percent = (label: string) =>
  z.preprocess(
    toNumber,
    z
      .number(`${label} is required`)
      .refine((n) => Number.isFinite(n), `${label} must be a number`)
      .refine((n) => n >= 0 && n <= 100, `${label} must be between 0 and 100`)
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use at most 2 decimals"),
  );

const amount = z.preprocess(
  toNumber,
  z
    .number("Amount is required")
    .refine((n) => Number.isFinite(n), "Amount must be a number")
    .refine((n) => n >= 0, "Amount can't be negative")
    .refine((n) => n <= 1e13, "Amount is too large")
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use at most 2 decimals"),
);

const dueAt = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === null || v === "") return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Pick a valid date and time" });
      return z.NEVER;
    }
    return d;
  });

/** FR-091 builder inputs. Figures (total, after discount, amounts) are always computed on the server. */
export const proposalSchema = z.object({
  customerName: z.string("Customer name is required").trim().min(1, "Customer name is required").max(200, "Use at most 200 characters"),
  preparedDate: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .pipe(z.iso.date("Use a valid date").nullable()),
  preparedByName: optionalText(120),
  preparedByTitle: optionalText(120),
  projectId: optionalId("Choose a project"),
  printTitle: optionalText(200),
  clientName: optionalText(200),
  customHeader: optionalText(200),
  unitId: optionalId("Choose a unit"),
  discountPct: percent("Discount %").default(0),
  downPaymentPct: percent("Down payment %").optional(),
  installmentCount: z
    .preprocess(toNumber, z.number("Number of installments is required").int("Use a whole number").min(1, "At least 1 installment").max(MAX_INSTALLMENTS, `At most ${MAX_INSTALLMENTS} installments`))
    .optional(),
  recurringLabel: optionalText(40),
  /** Month of the first installment ("YYYY-MM"); installments are due on the 10th (Q43). */
  firstInstallmentMonth: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .pipe(z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/, "Choose a month").nullable()),
  freeNightVouchers: z.preprocess(toNumber, z.number("Must be a number").int("Use a whole number").min(0, "Can't be negative").max(1000, "Too many").optional()),
  bonuses: optionalText(4000),
  whyActNow: optionalText(4000),
  nextSteps: optionalText(4000),
});
export type ProposalInput = z.input<typeof proposalSchema>;

export const planRowSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(80, "Use at most 80 characters"),
  description: optionalText(200),
  progress: optionalText(80),
  amount,
  dueOn: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .pipe(z.iso.date("Use a valid date").nullable()),
});

const rows = z.array(planRowSchema).max(MAX_INSTALLMENTS + 1, "Too many rows").optional();

const taskFields = {
  title: z.string("Title is required").trim().min(1, "Title is required").max(200, "Use at most 200 characters"),
  type: z.enum(TASK_TYPES, "Choose a type"),
  dueAt,
  assigneeId: optionalId("Choose an assignee"),
  leadId: optionalId("Choose a lead"),
  bookingId: optionalId("Choose a booking"),
  description: optionalText(4000),
};

export const createTaskSchema = z.object({ ...taskFields, proposal: proposalSchema.optional().nullable(), rows });
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z.object({ ...taskFields, proposal: proposalSchema.optional().nullable(), rows }).partial();

export const statusSchema = z.object({ status: z.enum(TASK_STATUSES, "Choose a status") });

export const taskListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(TASK_STATUSES).optional().catch(undefined),
  type: z.enum(TASK_TYPES).optional().catch(undefined),
  assignee: z.union([z.literal("me"), z.uuid()]).optional().catch(undefined),
  overdue: z.literal("1").optional().catch(undefined),
  sort: z.enum(TASK_SORT_COLUMNS).catch("updatedAt"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type TaskListQuery = z.output<typeof taskListQuerySchema>;

const optionalSetting = (label: string, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null ? null : toNumber(v)),
    z
      .number(`${label} must be a number`)
      .refine((n) => Number.isFinite(n) && n >= 0, `${label} can't be negative`)
      .refine((n) => n <= max, `${label} is too large`)
      .nullable(),
  );

/** FR-009 settings form. Blank clears an optional setting; required ones must stay set. */
export const proposalSettingsSchema = z
  .object({
    agentCap: percent("Agent discount cap"),
    managerCap: z.preprocess((v) => (v === "" || v === null ? null : toNumber(v)), percent("Manager discount cap").nullable()),
    downPaymentPct: percent("Down payment %"),
    installmentCount: z.preprocess(toNumber, z.number("Required").int("Use a whole number").min(1, "At least 1").max(MAX_INSTALLMENTS, `At most ${MAX_INSTALLMENTS}`)),
    defaultPricePerSqft: optionalSetting("Default price per sq ft", 1e9),
    roiPerSqft: optionalSetting("ROI per sq ft", 1e9),
    floorPriceGF: optionalSetting("Ground floor price per sq ft", 1e9),
    floorPriceFF: optionalSetting("First floor price per sq ft", 1e9),
    floorPriceSF: optionalSetting("Second floor price per sq ft", 1e9),
  })
  .partial();
