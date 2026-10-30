import { z } from "zod";

export const SIGNIN_PAGE_SIZE = 25;
export const SIGNIN_COUNT_DAYS = 30;
export const SIGNIN_EVENTS = ["sign_in", "sign_out"] as const;
export type SigninEvent = (typeof SIGNIN_EVENTS)[number];
export const SIGNIN_EVENT_LABELS: Record<SigninEvent, string> = { sign_in: "Signed in", sign_out: "Signed out" };

/** Parameters that would name another person. My Workplace is always the signed-in user's own. */
export const FOREIGN_USER_KEYS = ["userId", "user_id", "user", "employeeId", "agentId"] as const;

export const signinListQuerySchema = z.object({
  event: z.enum(SIGNIN_EVENTS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type SigninListQuery = z.output<typeof signinListQuerySchema>;
