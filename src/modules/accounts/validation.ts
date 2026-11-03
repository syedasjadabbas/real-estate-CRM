import { z } from "zod";
import { ROLES } from "@/server/auth/types";

/** SECURITY_AND_PRIVACY.md §1: minimum 10 characters. Upper bound matches the login form. */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

const name = z.string().trim().min(1, "Enter a name").max(100, "Use at most 100 characters").transform((v) => v.replace(/\s+/g, " "));
const email = z.string().trim().toLowerCase().max(254, "Use at most 254 characters").pipe(z.email("Enter a valid email address"));
const role = z.enum(ROLES, "Choose a role");
const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters`);

export const createAccountSchema = z
  .object({
    name,
    email,
    role,
    password,
    /** An HR record without a login (Q1) that this account belongs to; it is linked, not duplicated. */
    employeeRecordId: z.uuid("Choose an HR record").optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.password.trim().toLowerCase() === v.email) ctx.addIssue({ code: "custom", path: ["password"], message: "The password cannot be the email address" });
  });

export const updateAccountSchema = z.object({ name, role }).partial().strict();

export const resetPasswordSchema = z.object({ password }).strict();

export const accountStatusSchema = z.object({ status: z.enum(["active", "inactive"], "Choose a status") }).strict();

/** Which of the person's leads move (questionnaire Q3, "lead shift option"); the admin chooses each group. */
export const reassignLeadsSchema = z
  .object({
    toUserId: z.uuid("Choose who receives the leads"),
    open: z.boolean().default(false),
    lost: z.boolean().default(false),
    booked: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.open || v.lost || v.booked, { path: ["open"], message: "Choose at least one group of leads to move" });
