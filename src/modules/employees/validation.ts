import { z } from "zod";
import { normalizePhone } from "@/modules/leads/phone";

export const EMPLOYEE_PAGE_SIZE = 50;
export const EMPLOYEE_SORTS = ["name", "designation", "department", "role", "joiningDate", "status"] as const;
export type EmployeeSort = (typeof EMPLOYEE_SORTS)[number];
export const ROLES = ["super_admin", "admin", "manager", "agent", "hr", "accountant"] as const;

/** Joining dates are accepted in this range (input sanity only; future dates are allowed). */
export const MIN_JOINING_YEAR = 1900;
export const MAX_JOINING_YEAR = 2100;

/** Trims and collapses inner whitespace; blank becomes null. */
const squash = (v: string | null | undefined) => {
  const s = (v ?? "").trim().replace(/\s+/g, " ");
  return s ? s : null;
};

const freeText = (label: string) =>
  z
    .string()
    .optional()
    .nullable()
    .transform(squash)
    .pipe(z.string().max(100, `${label}: use at most 100 characters`).nullable());

const joiningDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v.trim() : null))
  .superRefine((v, ctx) => {
    if (!v) return;
    if (!z.iso.date().safeParse(v).success) {
      ctx.addIssue({ code: "custom", message: "Pick a valid date" });
      return;
    }
    const year = Number(v.slice(0, 4));
    if (year < MIN_JOINING_YEAR || year > MAX_JOINING_YEAR) ctx.addIssue({ code: "custom", message: `Pick a date between ${MIN_JOINING_YEAR} and ${MAX_JOINING_YEAR}` });
  });

/**
 * FR-140 HR profile fields. Account fields are not accepted (strict object), so a request that
 * tries to change name, email, role or status fails validation instead of being ignored.
 * Phone follows the lead rules: country code + number, normalised to E.164; blank number = no phone.
 */
export const profileSchema = z
  .object({
    designation: freeText("Designation"),
    department: freeText("Department"),
    phoneCountryCode: z.string().trim().optional().nullable(),
    phoneNumber: z.string().trim().max(25, "Use at most 25 characters").optional().nullable(),
    joiningDate,
  })
  .partial()
  .strict()
  .transform((v, ctx) => {
    const out: { designation?: string | null; department?: string | null; joiningDate?: string | null; phone?: { countryCode: string; national: string; e164: string } | null } = {};
    if ("designation" in v) out.designation = v.designation ?? null;
    if ("department" in v) out.department = v.department ?? null;
    if ("joiningDate" in v) out.joiningDate = v.joiningDate ?? null;
    if ("phoneNumber" in v || "phoneCountryCode" in v) {
      const number = v.phoneNumber ?? "";
      if (!number) out.phone = null;
      else {
        const cc = v.phoneCountryCode ?? "";
        if (!/^\+?[1-9]\d{0,3}$/.test(cc)) {
          ctx.addIssue({ code: "custom", path: ["phoneCountryCode"], message: "Invalid country code" });
          return z.NEVER;
        }
        if (number.length < 6) {
          ctx.addIssue({ code: "custom", path: ["phoneNumber"], message: "Enter a valid phone number" });
          return z.NEVER;
        }
        const phone = normalizePhone(cc, number);
        if (!phone) {
          ctx.addIssue({ code: "custom", path: ["phoneNumber"], message: "Enter a valid phone number" });
          return z.NEVER;
        }
        out.phone = phone;
      }
    }
    return out;
  });
export type ProfileInput = z.input<typeof profileSchema>;

export const employeeListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  role: z.enum(ROLES).optional().catch(undefined),
  status: z.enum(["active", "inactive"]).optional().catch(undefined),
  department: z.string().trim().min(1).max(100).optional().catch(undefined),
  sort: z.enum(EMPLOYEE_SORTS).catch("name"),
  dir: z.enum(["asc", "desc"]).catch("asc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type EmployeeListQuery = z.output<typeof employeeListQuerySchema>;
