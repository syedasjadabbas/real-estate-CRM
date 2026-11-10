/**
 * Backup status rules for the Settings → Backups page. Keep the retention constants in sync with
 * scripts/ops/backup-lib.mjs (tests/unit/backups-rules.test.ts checks this).
 */
export const DEFAULT_KEEP_DAILY = 30;
export const DEFAULT_KEEP_MONTHLY = 12;
export const MIN_KEEP_DAILY = 1;
export const MAX_KEEP_DAILY = 3650;
export const MIN_KEEP_MONTHLY = 0;
export const MAX_KEEP_MONTHLY = 1200;
export const LEGACY_RETENTION_VARS = ["BACKUP_RETENTION_DAYS", "BACKUP_RETENTION_COUNT"];
/** A nightly backup older than this means at least one night was missed. */
export const STALE_AFTER_HOURS = 26;

export type RetentionConfig = { daily: number | null; monthly: number | null; error: string | null; isDefault: boolean };

/** Reads BACKUP_KEEP_DAILY / BACKUP_KEEP_MONTHLY the same way the backup runner does. */
export function readRetention(env: Record<string, string | undefined>): RetentionConfig {
  const invalid = (error: string): RetentionConfig => ({ daily: null, monthly: null, error, isDefault: false });
  const legacy = LEGACY_RETENTION_VARS.filter((key) => env[key]?.trim());
  if (legacy.length) {
    return invalid(`${legacy.join(" and ")} ${legacy.length === 1 ? "is" : "are"} no longer used (replaced by BACKUP_KEEP_DAILY and BACKUP_KEEP_MONTHLY), so backups fail before they start.`);
  }
  const rawDaily = env.BACKUP_KEEP_DAILY?.trim();
  const rawMonthly = env.BACKUP_KEEP_MONTHLY?.trim();
  let daily = DEFAULT_KEEP_DAILY;
  let monthly = DEFAULT_KEEP_MONTHLY;
  if (rawDaily) {
    const n = Number(rawDaily);
    if (!Number.isInteger(n) || n < MIN_KEEP_DAILY || n > MAX_KEEP_DAILY) return invalid("BACKUP_KEEP_DAILY is not a valid number of days, so backups fail before they start.");
    daily = n;
  }
  if (rawMonthly) {
    const n = Number(rawMonthly);
    if (!Number.isInteger(n) || n < MIN_KEEP_MONTHLY || n > MAX_KEEP_MONTHLY) return invalid("BACKUP_KEEP_MONTHLY is not a valid number of months, so backups fail before they start.");
    monthly = n;
  }
  return { daily, monthly, error: null, isDefault: !rawDaily && !rawMonthly };
}

/** "30 daily, 12 monthly", "7 daily". */
export function describeRetention(r: Pick<RetentionConfig, "daily" | "monthly">) {
  if (!r.daily) return "Not set";
  return r.monthly ? `${r.daily} daily, ${r.monthly} monthly` : `${r.daily} daily`;
}

export type BackupHealth = { state: "none" | "ok" | "stale"; ageHours: number | null };

/** Whether the last successful backup is recent enough. `ageMs` is measured on the database clock. */
export function backupHealth(ageMs: number | null): BackupHealth {
  if (ageMs === null || !Number.isFinite(ageMs)) return { state: "none", ageHours: null };
  const ageHours = Math.max(0, ageMs) / 3_600_000;
  return { state: ageHours > STALE_AFTER_HOURS ? "stale" : "ok", ageHours };
}

/** "45 minutes", "5 hours", "3 days 4 hours". */
export function formatAge(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes`;
  if (hours < 48) return `${Math.round(hours)} hours`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h ? `${d} days ${h} hours` : `${d} days`;
}

export function formatSize(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}
