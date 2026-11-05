import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db";
import { users } from "@/server/db/schema";
import { fieldErrors } from "@/modules/leads/validation";
import { AppError } from "@/server/errors";
import { burnPasswordCheck, verifyPassword } from "./password";
import { clearFailures, isLimited, recordFailure } from "./rate-limit";
import { createSession, type RequestMeta } from "./session-store";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required").max(200),
});

const INVALID = "Incorrect email or password.";

/**
 * Verifies credentials and opens a session. Every failure looks the same, so sign-in never reveals
 * whether an account exists or is inactive: same error, and a password check in every case.
 */
export async function authenticate(db: Database, input: unknown, meta: RequestMeta = {}) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: fieldErrors(parsed.error) });
  }
  const { email, password } = parsed.data;
  const key = `${email.toLowerCase()}|${meta.ip ?? "unknown"}`;
  if (isLimited(key)) {
    throw new AppError("RATE_LIMITED", "Too many failed attempts. Try again in 15 minutes.");
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
    .limit(1);

  if (!user) {
    await burnPasswordCheck(password);
    recordFailure(key);
    throw new AppError("UNAUTHENTICATED", INVALID);
  }
  if (!(await verifyPassword(user.passwordHash, password)) || user.status !== "active") {
    recordFailure(key);
    throw new AppError("UNAUTHENTICATED", INVALID);
  }

  clearFailures(key);
  const session = await createSession(db, user.id, meta);
  return { ...session, userId: user.id };
}
