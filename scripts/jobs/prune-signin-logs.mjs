// Sign-in log retention cleanup (docs/PRODUCTION_READINESS_PLAN.md §3).
// Usage: npm run job:prune-signin-logs              (deletes only when enabled in Security settings)
//        npm run job:prune-signin-logs -- --dry-run  (never deletes; reports what is eligible)
//
// Run once a day by the host (cron, systemd timer or a Compose one-shot service; see
// docs/DEPLOYMENT_PROXY.md). Touches only `signin_logs`; audit logs are never deleted.
// Keep the keys and limits in sync with src/modules/security/retention.ts (a test checks this).
import { pathToFileURL } from "node:url";
import pg from "pg";

export const RETENTION_MONTHS_KEY = "security.signin_log_retention_months";
export const CLEANUP_ENABLED_KEY = "security.signin_log_cleanup_enabled";
export const LAST_RUN_KEY = "security.signin_log_cleanup_last_run";
export const DEFAULT_RETENTION_MONTHS = 12;
export const MIN_RETENTION_MONTHS = 3;
export const MAX_RETENTION_MONTHS = 120;
/** Arbitrary constant for pg_try_advisory_lock, so two runs never overlap. */
export const LOCK_KEY = 740_215_001;
const BATCH_SIZE = 5000;

/** Reads the stored months, or null when the stored value is not an allowed whole number. */
export function parseRetentionMonths(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_RETENTION_MONTHS;
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_RETENTION_MONTHS && n <= MAX_RETENTION_MONTHS ? n : null;
}

/**
 * Deletes sign-in logs older than the retention period, but only when cleanup is enabled and
 * this is not a dry run. Idempotent: the cutoff is fixed per run and a second run finds nothing.
 * `client` must be one connection (a pg.Client or a checked-out pool client): the advisory lock
 * belongs to that session.
 */
export async function pruneSigninLogs(client, { dryRun = false, batchSize = BATCH_SIZE } = {}) {
  const started = Date.now();
  const base = { job: "prune-signin-logs", dryRun };
  const {
    rows: [{ locked }],
  } = await client.query("select pg_try_advisory_lock($1) as locked", [LOCK_KEY]);
  if (!locked) return { ...base, status: "skipped", reason: "Another cleanup run is in progress.", deleted: 0, durationMs: Date.now() - started };

  try {
    const { rows: settings } = await client.query("select key, value from app_settings where key = any($1)", [[RETENTION_MONTHS_KEY, CLEANUP_ENABLED_KEY]]);
    const map = new Map(settings.map((r) => [r.key, r.value]));
    const retentionMonths = parseRetentionMonths(map.get(RETENTION_MONTHS_KEY));
    const enabled = map.get(CLEANUP_ENABLED_KEY) === "true";
    if (retentionMonths === null) {
      return { ...base, status: "invalid_setting", reason: `Stored retention is not ${MIN_RETENTION_MONTHS}–${MAX_RETENTION_MONTHS} months; nothing deleted.`, enabled, deleted: 0, durationMs: Date.now() - started };
    }

    // Database clock, so the cutoff never depends on the host clock.
    const {
      rows: [{ cutoff }],
    } = await client.query("select now() - make_interval(months => $1::int) as cutoff", [retentionMonths]);
    const {
      rows: [{ eligible }],
    } = await client.query("select count(*)::int as eligible from signin_logs where at < $1", [cutoff]);

    let deleted = 0;
    const status = dryRun ? "dry_run" : enabled ? "completed" : "disabled";
    if (status === "completed") {
      for (;;) {
        const res = await client.query("delete from signin_logs where id in (select id from signin_logs where at < $1 limit $2)", [cutoff, batchSize]);
        deleted += res.rowCount ?? 0;
        if ((res.rowCount ?? 0) < batchSize) break;
      }
    }

    const result = { ...base, status, enabled, retentionMonths, cutoff: new Date(cutoff).toISOString(), eligible, deleted, durationMs: Date.now() - started };
    const at = new Date().toISOString();
    await client.query(
      `insert into app_settings (key, value, updated_at) values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [LAST_RUN_KEY, JSON.stringify({ at, status, eligible, deleted, retentionMonths, cutoff: result.cutoff })],
    );
    if (status === "completed") {
      await client.query(
        "insert into audit_logs (actor_id, action, entity, entity_id, after) values (null, 'system.signin_log_retention', 'signin_logs', null, $1)",
        [JSON.stringify({ retentionMonths, cutoff: result.cutoff, eligible, deleted })],
      );
    }
    return result;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
  }
}

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // rely on the shell environment (production)
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(JSON.stringify({ job: "prune-signin-logs", status: "error", reason: "DATABASE_URL is not set" }));
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await pruneSigninLogs(client, { dryRun: process.argv.includes("--dry-run") });
    console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
  } catch (error) {
    console.error(JSON.stringify({ job: "prune-signin-logs", status: "error", reason: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
