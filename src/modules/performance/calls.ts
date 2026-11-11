import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { files } from "@/server/db/schema";

/**
 * Calls (client confirmation 10 Nov 2026: "Calls = uploaded recordings linked to a lead (one recording = one call)").
 *
 * - A call is a row in `files` with kind = 'call_recording', lead_id not null and deleted_at null
 *   (a recording hidden by a Super Admin no longer counts).
 * - It is attributed to its uploader (`uploaded_by_id`) and counted by `created_at` (upload time) inside the
 *   window [start, end). Callers pass only the agents already in their scope (Performance P11 / targetScope).
 * - Call minutes = sum of `duration_sec` / 60 over the calls that have a duration, rounded to whole minutes;
 *   null (shown "—") when none of them has one.
 * - Call quality (FR-152): duration ≥ 30 s = verified, ≥ 60 s = qualified (a qualified call is also verified).
 *   Calls with no duration still count as calls but fall in neither bucket.
 */
export const VERIFIED_CALL_SEC = 30;
export const QUALIFIED_CALL_SEC = 60;

export type CallStats = {
  /** Recordings uploaded in the window. */
  calls: number;
  /** Of those, recordings with a stored duration. */
  timed: number;
  /** Sum of the stored durations, in seconds. */
  seconds: number;
  /** Duration ≥ 30 s. */
  verified: number;
  /** Duration ≥ 60 s. */
  qualified: number;
};

export const NO_CALLS: CallStats = { calls: 0, timed: 0, seconds: 0, verified: 0, qualified: 0 };

/** Whole call minutes, or null when no call in the set has a duration. */
export function callMinutes(stats: Pick<CallStats, "timed" | "seconds">) {
  return stats.timed > 0 ? Math.round(stats.seconds / 60) : null;
}

/** Per-uploader call stats for the window. A plain `db` read: callers may run it in Promise.all, never on a shared transaction. */
export async function callStatsByUser(db: Database, userIds: string[], window: { start: Date; end: Date }): Promise<Map<string, CallStats>> {
  const out = new Map<string, CallStats>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({
      userId: files.uploadedById,
      calls: sql<number>`count(*)::int`,
      timed: sql<number>`count(${files.durationSec})::int`,
      seconds: sql<string>`coalesce(sum(${files.durationSec}), 0)`,
      verified: sql<number>`count(*) filter (where ${files.durationSec} >= ${VERIFIED_CALL_SEC})::int`,
      qualified: sql<number>`count(*) filter (where ${files.durationSec} >= ${QUALIFIED_CALL_SEC})::int`,
    })
    .from(files)
    .where(
      and(
        eq(files.kind, "call_recording"),
        isNotNull(files.leadId),
        isNull(files.deletedAt),
        inArray(files.uploadedById, userIds),
        gte(files.createdAt, window.start),
        lt(files.createdAt, window.end),
      ),
    )
    .groupBy(files.uploadedById);
  for (const r of rows) {
    if (!r.userId) continue;
    out.set(r.userId, { calls: Number(r.calls), timed: Number(r.timed), seconds: Number(r.seconds), verified: Number(r.verified), qualified: Number(r.qualified) });
  }
  return out;
}
