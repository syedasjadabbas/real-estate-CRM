import { z } from "zod";

export const HOLIDAY_SCOPES = ["company", "regional"] as const;
export type HolidayScope = (typeof HOLIDAY_SCOPES)[number];
export const HOLIDAY_SCOPE_LABELS: Record<HolidayScope, string> = { company: "Company-wide", regional: "Regional" };

/** Accepted calendar years (input sanity only, to catch typos such as 0202). */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

export const HOLIDAY_SORTS = ["date", "name"] as const;
export type HolidaySort = (typeof HOLIDAY_SORTS)[number];

/** Trims and collapses inner whitespace so "Eid  ul  Fitr " and "Eid ul Fitr" are the same name. */
const squash = (v: string) => v.trim().replace(/\s+/g, " ");

const holidayDate = z
  .string("Pick a date")
  .trim()
  .min(1, "Pick a date")
  .superRefine((v, ctx) => {
    if (!v) return;
    if (!z.iso.date().safeParse(v).success) {
      ctx.addIssue({ code: "custom", message: "Pick a valid date" });
      return;
    }
    const year = Number(v.slice(0, 4));
    if (year < MIN_YEAR || year > MAX_YEAR) ctx.addIssue({ code: "custom", message: `Pick a date between ${MIN_YEAR} and ${MAX_YEAR}` });
  });

const name = z.string("Name is required").transform(squash).pipe(z.string().min(2, "Use at least 2 characters").max(100, "Use at most 100 characters"));

const region = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? squash(v) : null))
  .pipe(z.string().max(80, "Use at most 80 characters").nullable());

/** Company-wide holidays have no region; regional ones need one (DATA_MODEL §7, plan §7). */
export function regionIssue(scope: HolidayScope, value: string | null): string | null {
  if (scope === "regional" && !value) return "Enter the region for a regional holiday";
  if (scope === "regional" && value && value.length < 2) return "Use at least 2 characters";
  if (scope === "company" && value) return "Company-wide holidays have no region";
  return null;
}

const fields = { date: holidayDate, name, scope: z.enum(HOLIDAY_SCOPES, "Choose company-wide or regional").default("company"), region };

export const createHolidaySchema = z.object(fields).superRefine((v, ctx) => {
  const issue = regionIssue(v.scope, v.region);
  if (issue) ctx.addIssue({ code: "custom", path: ["region"], message: issue });
});
export type CreateHolidayInput = z.input<typeof createHolidaySchema>;

/** Partial update; the region / scope pair is checked after merging with the stored row. */
export const updateHolidaySchema = z.object({ ...fields, scope: z.enum(HOLIDAY_SCOPES, "Choose company-wide or regional") }).partial();

export const holidayListQuerySchema = z.object({
  year: z.coerce.number().int().min(MIN_YEAR).max(MAX_YEAR).optional().catch(undefined),
  scope: z.enum(HOLIDAY_SCOPES).optional().catch(undefined),
  region: z.string().trim().min(1).max(80).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  sort: z.enum(HOLIDAY_SORTS).catch("date"),
  dir: z.enum(["asc", "desc"]).catch("asc"),
});
export type HolidayListQuery = z.output<typeof holidayListQuerySchema>;

/** Weekday name of a YYYY-MM-DD calendar date (no time zone drift). */
export function weekdayOf(date: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
