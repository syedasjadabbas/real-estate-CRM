import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { backupRuns, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { assertCanViewBackups } from "./policy";
import { backupHealth, readRetention } from "./rules";

export const RECENT_RUNS_LIMIT = 50;

/**
 * Settings → Backups (Super Admin only): recent backup, retention and restore runs, the age of the
 * last successful backup (database clock) and the retention configured on the server. Read only;
 * backup_runs never holds backup contents or credentials, and nothing here exposes a file path.
 */
export async function getBackupOverview(db: Database, actor: Actor, env: Record<string, string | undefined> = process.env) {
  assertCanViewBackups(actor);
  const runs = await db
    .select({
      id: backupRuns.id,
      kind: backupRuns.kind,
      status: backupRuns.status,
      trigger: backupRuns.trigger,
      location: backupRuns.location,
      sizeBytes: backupRuns.sizeBytes,
      message: backupRuns.message,
      actorName: users.name,
      startedAt: backupRuns.startedAt,
      finishedAt: backupRuns.finishedAt,
    })
    .from(backupRuns)
    .leftJoin(users, eq(users.id, backupRuns.actorId))
    .orderBy(desc(backupRuns.startedAt), desc(backupRuns.id))
    .limit(RECENT_RUNS_LIMIT);

  const [last] = await db
    .select({
      location: backupRuns.location,
      sizeBytes: backupRuns.sizeBytes,
      finishedAt: backupRuns.finishedAt,
      ageMs: sql<number>`(extract(epoch from (now() - coalesce(${backupRuns.finishedAt}, ${backupRuns.startedAt}))) * 1000)::float8`,
    })
    .from(backupRuns)
    .where(and(eq(backupRuns.kind, "backup"), eq(backupRuns.status, "succeeded")))
    .orderBy(desc(sql`coalesce(${backupRuns.finishedAt}, ${backupRuns.startedAt})`))
    .limit(1);

  const [failures] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(backupRuns)
    .where(and(eq(backupRuns.status, "failed"), sql`${backupRuns.startedAt} > now() - interval '7 days'`));

  return {
    runs,
    lastBackup: last ? { location: last.location, sizeBytes: last.sizeBytes, finishedAt: last.finishedAt, ageMs: Number(last.ageMs) } : null,
    health: backupHealth(last ? Number(last.ageMs) : null),
    failuresLast7Days: failures?.n ?? 0,
    retention: readRetention(env),
    offServerCopy: Boolean(env.BACKUP_REMOTE?.trim()),
  };
}
export type BackupOverview = Awaited<ReturnType<typeof getBackupOverview>>;
