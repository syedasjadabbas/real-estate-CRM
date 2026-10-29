import { z } from "zod";
import { MEETING_SORT_COLUMNS, MEETING_STATUSES } from "./constants";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const dateTime = (required: boolean) =>
  z
    .union([z.string(), z.date(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === null || v === "") {
        if (required) ctx.addIssue({ code: "custom", message: "Pick a date and time" });
        return null;
      }
      const d = v instanceof Date ? v : new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "Pick a valid date and time" });
        return z.NEVER;
      }
      return d;
    });

const optionalId = (message: string) =>
  z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .pipe(z.uuid(message).nullable());

const fields = {
  title: z.string("Title is required").trim().min(1, "Title is required").max(200, "Use at most 200 characters"),
  startsAt: dateTime(true),
  endsAt: dateTime(false),
  location: optionalText(200),
  organizerId: optionalId("Choose an organizer"),
  leadId: z.string("Choose a lead").trim().pipe(z.uuid("Choose a lead")),
  notes: optionalText(4000),
};

/** End time, when given, must be after the start (assumption M-A4). */
const endAfterStart = <T extends { startsAt?: Date | null; endsAt?: Date | null }>(v: T, ctx: z.RefinementCtx) => {
  if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after the start" });
};

/** FR-100 create. `moveLead` is the D2 checkbox ("Also move lead to Meeting Scheduled"). */
export const createMeetingSchema = z.object({ ...fields, moveLead: z.boolean().optional().default(true) }).superRefine(endAfterStart);
export type CreateMeetingInput = z.input<typeof createMeetingSchema>;

export const updateMeetingSchema = z.object(fields).partial().superRefine(endAfterStart);

/** D1 checkbox on completion ("Also move lead to Meeting Done") and an optional outcome note (M-A6). */
export const completeSchema = z.object({ note: optionalText(1000), moveLead: z.boolean().optional().default(true) });
export const cancelSchema = z.object({ note: optionalText(1000) });

export const meetingListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(MEETING_STATUSES).optional().catch(undefined),
  organizer: z.union([z.literal("me"), z.uuid()]).optional().catch(undefined),
  lead: z.uuid().optional().catch(undefined),
  overdue: z.literal("1").optional().catch(undefined),
  sort: z.enum(MEETING_SORT_COLUMNS).catch("startsAt"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type MeetingListQuery = z.output<typeof meetingListQuerySchema>;
