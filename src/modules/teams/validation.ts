import { z } from "zod";

/** Teams list (FR-005). With no sort it keeps its default order (active first, then name). */
export const TEAM_PAGE_SIZE = 50;
export const TEAM_SORT_COLUMNS = ["name", "manager", "members", "status"] as const;
export type TeamSort = (typeof TEAM_SORT_COLUMNS)[number];
export const teamListQuerySchema = z.object({
  sort: z.enum(TEAM_SORT_COLUMNS).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).catch("asc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export const ROSTER_STATUSES = ["in_office", "on_site", "on_leave", "leads_off"] as const;
export type RosterStatus = (typeof ROSTER_STATUSES)[number];
export const ROSTER_STATUS_LABELS: Record<RosterStatus, string> = {
  in_office: "In office",
  on_site: "On site",
  on_leave: "On leave",
  leads_off: "Leads off",
};

const isoDate = z.iso.date("Use a valid date");
const optionalId = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .pipe(z.uuid("Choose a manager").nullable());

/** FR-120 team fields. */
export const createTeamSchema = z.object({
  name: z.string("Name is required").trim().min(2, "Use at least 2 characters").max(80, "Use at most 80 characters"),
  managerId: optionalId,
  isActive: z.boolean().optional().default(true),
  /** Q5: members see this region's holidays. Blank = no region. */
  region: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.trim().replace(/\s+/g, " ") : null) || null)
    .pipe(z.string().max(80, "Use at most 80 characters").nullable()),
  /** Q9: weekends vary by team. 0 = Sunday … 6 = Saturday; stored sorted, without duplicates. */
  weekendDays: z
    .array(z.number().int().min(0, "Invalid day").max(6, "Invalid day"))
    .max(6, "Leave at least one working day")
    .optional()
    .default([])
    .transform((d) => [...new Set(d)].sort((a, b) => a - b)),
});
export const updateTeamSchema = createTeamSchema.partial();

export const membersSchema = z.object({
  userIds: z.array(z.uuid("Invalid member")).max(200, "Too many members"),
});

const count = (label: string) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? 0 : typeof v === "string" ? Number(v) : v),
    z.number(`${label} must be a number`).int(`${label}: use a whole number`).min(0, `${label} can't be negative`).max(100_000, `${label} is too large`),
  );

/** FR-121 per-agent line (manual entry, Q-H3 default). */
export const dailyReportSchema = z.object({
  lines: z
    .array(
      z.object({
        agentId: z.uuid("Invalid agent"),
        leads: count("Leads"),
        calls: count("Calls"),
        meetings: count("Meetings"),
        tokens: count("Tokens"),
        bookings: count("Bookings"),
        remarks: z
          .string()
          .trim()
          .max(500, "Use at most 500 characters")
          .optional()
          .nullable()
          .transform((v) => (v ? v : null)),
      }),
    )
    .max(200),
});

/** FR-122: a status per member; null clears the day. */
export const rosterSchema = z.object({
  entries: z.array(z.object({ userId: z.uuid("Invalid member"), status: z.enum(ROSTER_STATUSES).nullable() })).max(200),
});

export const dateParam = isoDate;
export const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11");

export const reportRangeSchema = z.object({
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  team: z.uuid().optional().catch(undefined),
});
