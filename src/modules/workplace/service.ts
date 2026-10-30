import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { signinLogs } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { upcomingHolidays } from "@/modules/holidays/service";
import { browserLabel } from "./user-agent";
import { FOREIGN_USER_KEYS, SIGNIN_COUNT_DAYS, SIGNIN_PAGE_SIZE, signinListQuerySchema } from "./validation";

/** Rejects any attempt to name another user instead of silently ignoring it. */
function assertOwnOnly(input: Record<string, unknown>) {
  const foreign = FOREIGN_USER_KEYS.filter((k) => k in input);
  if (foreign.length > 0) {
    throw new AppError("VALIDATION_FAILED", "My Workplace only shows your own records.", {
      fields: Object.fromEntries(foreign.map((k) => [k, "Not allowed"])),
    });
  }
}

/**
 * The signed-in user's own CRM sign-in log (FR-002), newest first. The user is always `actor.id`;
 * no parameter can select anyone else. Rows are shown as recorded: no sessions, durations or
 * locations are derived from them.
 */
export async function listMySignins(db: Database, actor: Actor, input: unknown = {}) {
  const raw = (input ?? {}) as Record<string, unknown>;
  assertOwnOnly(raw);
  const query = signinListQuerySchema.parse(raw);
  const own = eq(signinLogs.userId, actor.id);
  const where = and(own, query.event ? eq(signinLogs.event, query.event) : undefined);
  const [[{ total }], [{ recent }]] = await Promise.all([
    db.select({ total: count() }).from(signinLogs).where(where),
    // Database clock, like session expiry, so the window never depends on the app server clock.
    db
      .select({ recent: sql<number>`count(*)::int` })
      .from(signinLogs)
      .where(and(own, eq(signinLogs.event, "sign_in"), sql`${signinLogs.at} >= now() - make_interval(days => ${SIGNIN_COUNT_DAYS})`)),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / SIGNIN_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const rows = await db
    .select({ id: signinLogs.id, event: signinLogs.event, at: signinLogs.at, ip: signinLogs.ip, userAgent: signinLogs.userAgent })
    .from(signinLogs)
    .where(where)
    .orderBy(desc(signinLogs.at), desc(signinLogs.id))
    .limit(SIGNIN_PAGE_SIZE)
    .offset((page - 1) * SIGNIN_PAGE_SIZE);
  return {
    query: { ...query, page },
    total,
    page,
    pageCount,
    recentSignins: recent,
    rows: rows.map((r) => ({ ...r, browser: browserLabel(r.userAgent) })),
  };
}
export type SigninRow = Awaited<ReturnType<typeof listMySignins>>["rows"][number];

/**
 * My Workplace (FR-130) for the signed-in user: upcoming holidays and their own sign-in log.
 * My leave waits on the HR leave questions (Q3, Q3b, Q5, Q6), so no leave data is returned.
 */
export async function getMyWorkplace(db: Database, actor: Actor, input: unknown = {}) {
  const [holidays, signins] = await Promise.all([upcomingHolidays(db), listMySignins(db, actor, input)]);
  return { holidays, signins, leave: { status: "pending_client_decision" as const } };
}
