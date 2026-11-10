// Pure rules shared by backup-run.mjs and restore.mjs (no database, no shell, no deletion here).
// Unit tested in tests/unit/backups-rules.test.ts. Keep the retention constants in sync with
// src/modules/backups/rules.ts (a test checks this).
import path from "node:path";

/** Folder names written by backup.sh: `date -u +%Y%m%dT%H%M%SZ`, e.g. 20261110T020000Z. */
export const BACKUP_FOLDER_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
/** The files backup.sh writes into every folder. */
export const BACKUP_FILES = ["database.dump", "storage.tar.gz", "SHA256SUMS"];
/** Files listed in SHA256SUMS. */
export const CHECKSUMMED_FILES = ["database.dump", "storage.tar.gz"];

/** Client requirement: the newest backup of each of the last 30 days and of each of the last 12 months. */
export const DEFAULT_KEEP_DAILY = 30;
export const DEFAULT_KEEP_MONTHLY = 12;
export const MIN_KEEP_DAILY = 1;
export const MAX_KEEP_DAILY = 3650;
export const MIN_KEEP_MONTHLY = 0;
export const MAX_KEEP_MONTHLY = 1200;
/** Settings from the earlier age/count rule. Setting either is a configuration error, never silently ignored. */
export const LEGACY_RETENTION_VARS = ["BACKUP_RETENTION_DAYS", "BACKUP_RETENTION_COUNT"];
/** Days and months are counted in Pakistan Standard Time (UTC+5, no daylight saving), like the rest of the CRM. */
export const RETENTION_UTC_OFFSET_MINUTES = 300;
/** Retention never removes the newest complete backups below this number. */
export const MIN_KEEP_COMPLETE = 1;
/** One advisory lock for backup, prune and restore, so they never overlap. */
export const BACKUP_LOCK_KEY = 740_215_002;
/** Longest message stored in backup_runs.message. */
export const MAX_MESSAGE_LENGTH = 500;
/** size_bytes is a PostgreSQL integer column. */
export const MAX_SIZE_COLUMN = 2_147_483_647;

/** The UTC time in a backup folder name, or null when the name is not exactly a backup folder. */
export function parseBackupStamp(name) {
  if (typeof name !== "string") return null;
  const m = BACKUP_FOLDER_RE.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Rejects impossible dates such as 20261340T990000Z (Date.UTC would roll them over).
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || date.getUTCHours() !== h || date.getUTCMinutes() !== mi || date.getUTCSeconds() !== s) return null;
  return date;
}

export function isBackupFolderName(name) {
  return parseBackupStamp(name) !== null;
}

/**
 * Reads BACKUP_KEEP_DAILY (default 30) and BACKUP_KEEP_MONTHLY (default 12; 0 = no monthly copies).
 * Returns `{ daily, monthly }` or `{ error }`. The old BACKUP_RETENTION_DAYS / BACKUP_RETENTION_COUNT
 * are refused with a message naming the replacements, so an old env file can't quietly change the rule.
 */
export function parseRetention(env = {}) {
  const legacy = LEGACY_RETENTION_VARS.filter((key) => env[key] !== undefined && String(env[key]).trim() !== "");
  if (legacy.length) {
    return { error: `${legacy.join(" and ")} ${legacy.length === 1 ? "is" : "are"} no longer used. Remove ${legacy.length === 1 ? "it" : "them"} and set BACKUP_KEEP_DAILY (default ${DEFAULT_KEEP_DAILY}) and BACKUP_KEEP_MONTHLY (default ${DEFAULT_KEEP_MONTHLY}) instead.` };
  }
  const read = (key, fallback, min, max, what) => {
    const raw = env[key];
    if (raw === undefined || String(raw).trim() === "") return { value: fallback };
    const n = Number(String(raw).trim());
    if (!Number.isInteger(n) || n < min || n > max) return { error: `${key} must be a whole number of ${what} from ${min} to ${max}.` };
    return { value: n };
  };
  const daily = read("BACKUP_KEEP_DAILY", DEFAULT_KEEP_DAILY, MIN_KEEP_DAILY, MAX_KEEP_DAILY, "days");
  if (daily.error) return { error: daily.error };
  const monthly = read("BACKUP_KEEP_MONTHLY", DEFAULT_KEEP_MONTHLY, MIN_KEEP_MONTHLY, MAX_KEEP_MONTHLY, "months");
  if (monthly.error) return { error: monthly.error };
  return { daily: daily.value, monthly: monthly.value };
}

/** Plain-language summary of the retention rule, for logs and the Backups page. */
export function describeRetention({ daily, monthly }) {
  const parts = [`each of the last ${daily} day${daily === 1 ? "" : "s"}`];
  if (monthly) parts.push(`each of the last ${monthly} month${monthly === 1 ? "" : "s"}`);
  return `Keeps the newest complete backup from ${parts.join(" and from ")} in the local backup folder and removes the rest; the newest complete backup is always kept.`;
}

const OFFSET_MS = RETENTION_UTC_OFFSET_MINUTES * 60_000;
/** "2026-11-10" in Pakistan time. */
export function retentionDay(date) {
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}
/** "2026-11" in Pakistan time. */
export function retentionMonth(date) {
  return retentionDay(date).slice(0, 7);
}

/**
 * Chooses which folders retention removes. `entries` are `{ name, isDirectory, complete }` read
 * from BACKUP_DIR (`complete` = all three backup files present). Keeps:
 * - daily: the newest complete backup of each of the last `daily` days (today included);
 * - monthly: the newest complete backup of each of the last `monthly` months (this month included);
 * - the newest complete backup, whatever its age;
 * - incomplete folders inside the daily window, so a recent failure can still be inspected.
 * Never chooses anything whose name is not exactly a backup folder name, that is not a real
 * directory, or that is dated in the future (clock trouble). Everything else is removed.
 * @param {{ name: string, isDirectory: boolean, complete: boolean }[]} entries
 * @param {{ daily?: number, monthly?: number, now?: Date }} [options]
 */
export function selectForPruning(entries, { daily = DEFAULT_KEEP_DAILY, monthly = DEFAULT_KEEP_MONTHLY, now = new Date() } = {}) {
  const candidates = entries
    .filter((e) => e && e.isDirectory === true && isBackupFolderName(e.name))
    .map((e) => ({ ...e, at: parseBackupStamp(e.name) }))
    .filter((e) => e.at.getTime() <= now.getTime())
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const today = new Date(`${retentionDay(now)}T00:00:00Z`);
  const days = new Set(Array.from({ length: daily }, (_, i) => new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10)));
  const [year, month] = retentionMonth(now).split("-").map(Number);
  const months = new Set(Array.from({ length: monthly }, (_, i) => new Date(Date.UTC(year, month - 1 - i, 1)).toISOString().slice(0, 7)));

  const reasons = new Map();
  const add = (name, reason) => reasons.set(name, [...(reasons.get(name) ?? []), reason]);
  const seenDays = new Set();
  const seenMonths = new Set();
  const complete = candidates.filter((e) => e.complete);
  if (complete.length) add(complete[0].name, "newest");
  for (const e of complete) {
    const day = retentionDay(e.at);
    const mon = retentionMonth(e.at);
    if (days.has(day) && !seenDays.has(day)) { seenDays.add(day); add(e.name, "daily"); }
    if (months.has(mon) && !seenMonths.has(mon)) { seenMonths.add(mon); add(e.name, "monthly"); }
  }
  for (const e of candidates) if (!e.complete && days.has(retentionDay(e.at))) add(e.name, "recent-incomplete");

  const remove = [];
  const keep = [];
  for (const e of candidates) (reasons.has(e.name) ? keep : remove).push(e.name);
  return { remove, keep, reasons };
}

/**
 * The absolute path of a backup folder inside BACKUP_DIR, or throws. Guards every deletion and
 * every restore: the name must be a backup folder name and the result must sit directly in
 * BACKUP_DIR (no "..", no separators, no absolute names).
 */
export function backupFolderPath(backupDir, name) {
  if (!backupDir || !path.isAbsolute(backupDir)) throw new Error("BACKUP_DIR must be an absolute path.");
  if (!isBackupFolderName(name)) throw new Error(`"${String(name).slice(0, 60)}" is not a backup folder name (expected e.g. 20261110T020000Z).`);
  const root = path.resolve(backupDir);
  const full = path.resolve(root, name);
  if (path.dirname(full) !== root || path.basename(full) !== name) throw new Error("Backup folder must be directly inside BACKUP_DIR.");
  return full;
}

/** True when `child` is `parent` or inside it (resolved, case-sensitive like Linux). */
export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Configuration problems that stop a backup before it starts. Returns a list of messages. */
export function checkBackupConfig(env = {}, appDir = process.cwd()) {
  const problems = [];
  for (const key of ["DATABASE_URL", "FILE_STORAGE_DIR", "BACKUP_DIR"]) if (!env[key]) problems.push(`${key} is not set.`);
  const { BACKUP_DIR: backupDir, FILE_STORAGE_DIR: storageDir } = env;
  if (backupDir && !path.isAbsolute(backupDir)) problems.push("BACKUP_DIR must be an absolute path.");
  if (backupDir && path.isAbsolute(backupDir)) {
    if (path.resolve(backupDir) === path.parse(path.resolve(backupDir)).root) problems.push("BACKUP_DIR must not be the filesystem root.");
    if (isInside(backupDir, appDir) || isInside(appDir, backupDir)) problems.push("BACKUP_DIR must be outside the app folder.");
    if (storageDir && (isInside(storageDir, backupDir) || isInside(backupDir, storageDir))) problems.push("BACKUP_DIR and FILE_STORAGE_DIR must not contain each other.");
  }
  const retention = parseRetention(env);
  if (retention.error) problems.push(retention.error);
  return problems;
}

/**
 * Parses SHA256SUMS (`<64 hex>  <file>` per line, as written by sha256sum). Returns a Map of
 * file → hash, or throws when the list is malformed or does not name exactly the expected files.
 */
export function parseChecksums(text, expected = CHECKSUMMED_FILES) {
  const map = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
    if (!m) throw new Error("SHA256SUMS has a line that is not a checksum.");
    if (map.has(m[2])) throw new Error(`SHA256SUMS lists ${m[2]} twice.`);
    map.set(m[2], m[1].toLowerCase());
  }
  const names = [...map.keys()].sort();
  if (names.join("\n") !== [...expected].sort().join("\n")) throw new Error(`SHA256SUMS must list exactly ${expected.join(" and ")}.`);
  return map;
}

/**
 * Removes credentials and connection strings from a message before it is stored or printed, and
 * keeps it to one bounded line.
 */
export function sanitizeMessage(text, max = MAX_MESSAGE_LENGTH) {
  let s = String(text ?? "")
    .replace(/\b(postgres(?:ql)?|mysql|https?|rsync|ssh|s3):\/\/[^\s'"]*/gi, "$1://[redacted]")
    .replace(/\b(PGPASSWORD|PASSWORD|PASSWD|SECRET|TOKEN|DATABASE_URL)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s;
}

/** The value for backup_runs.size_bytes (an integer column): null when it does not fit. */
export function toSizeColumn(bytes) {
  return Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= MAX_SIZE_COLUMN ? bytes : null;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

/**
 * Reads the rows of `COPY <table> (...) FROM stdin;` blocks in plain SQL produced by
 * `pg_restore -f -`. Returns `{ columns, rows }` (rows as arrays of text fields) for the first
 * block whose table name ends with `tableSuffix`, or null when there is none.
 */
export function readCopyBlock(sqlText, tableSuffix) {
  const lines = String(sqlText).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^COPY\s+(\S+)\s*\(([^)]*)\)\s+FROM\s+stdin;$/i.exec(lines[i]);
    if (!m || !m[1].replace(/"/g, "").endsWith(tableSuffix)) continue;
    const columns = m[2].split(",").map((c) => c.trim().replace(/"/g, ""));
    const rows = [];
    for (let j = i + 1; j < lines.length && lines[j] !== "\\."; j += 1) rows.push(lines[j].split("\t"));
    return { columns, rows };
  }
  return null;
}

/**
 * Restore refuses a backup made by newer code than this checkout: more migrations, or a newer
 * latest migration time, than drizzle/meta/_journal.json. `backup` is `{ count, latest }` from the
 * dump's drizzle.__drizzle_migrations table, `code` the same from the journal.
 */
export function checkMigrationCompat(backup, code) {
  if (!backup || !Number.isInteger(backup.count)) return { ok: false, reason: "The backup's migration history could not be read." };
  if (backup.count === 0) return { ok: false, reason: "The backup has no migration history, so it is not a CRM database backup." };
  if (backup.count > code.count) return { ok: false, reason: `The backup has ${backup.count} migrations but this code has ${code.count}. Deploy the code the backup was made with (or newer) first.` };
  if (Number.isFinite(backup.latest) && Number.isFinite(code.latest) && backup.latest > code.latest) {
    return { ok: false, reason: "The backup's latest migration is newer than this code's. Deploy the code the backup was made with (or newer) first." };
  }
  return { ok: true, reason: backup.count === code.count ? "Backup and code are on the same migration." : `${code.count - backup.count} newer migration(s) will be applied after the restore.` };
}

/** Migration count and latest time from drizzle/meta/_journal.json contents. */
export function journalMigrations(journal) {
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  return { count: entries.length, latest: entries.reduce((m, e) => Math.max(m, Number(e.when) || 0), 0) };
}

/** Migration count and latest time from the dump's __drizzle_migrations COPY block. */
export function dumpMigrations(sqlText) {
  const block = readCopyBlock(sqlText, "__drizzle_migrations");
  if (!block) return null;
  const at = block.columns.indexOf("created_at");
  const latest = at < 0 ? NaN : block.rows.reduce((m, r) => Math.max(m, Number(r[at]) || 0), 0);
  return { count: block.rows.length, latest };
}

/**
 * Checks `tar -tzf storage.tar.gz` output before anything is extracted: exactly one top-level
 * folder, and no absolute paths or ".." parts. Returns `{ ok, top, reason }`.
 */
export function checkArchiveListing(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { ok: false, top: null, reason: "The storage archive is empty." };
  const tops = new Set();
  for (const l of lines) {
    if (l.startsWith("/") || /^[A-Za-z]:/.test(l) || l.split(/[\\/]/).includes("..")) return { ok: false, top: null, reason: "The storage archive contains an unsafe path." };
    tops.add(l.replace(/^\.\//, "").split("/")[0]);
  }
  tops.delete("");
  if (tops.size !== 1) return { ok: false, top: null, reason: "The storage archive must contain exactly one top-level folder." };
  const [top] = tops;
  if (top === "." || top === "..") return { ok: false, top: null, reason: "The storage archive contains an unsafe path." };
  return { ok: true, top, reason: `${lines.length} entries under ${top}/` };
}

/** Restore refuses while any other session is connected to the target database. */
export function checkConnections(otherConnections) {
  return otherConnections === 0
    ? { ok: true, reason: "No other connections to the database." }
    : { ok: false, reason: `${otherConnections} other connection(s) to the database. Stop the app (systemctl stop mz-crm) and close other clients first.` };
}

/** The folder names restore uses next to FILE_STORAGE_DIR (both kept; nothing is deleted). */
export function storageRestoreNames(storageDir, stamp) {
  const parent = path.dirname(path.resolve(storageDir));
  const base = path.basename(path.resolve(storageDir));
  return { parent, base, staging: path.join(parent, `.${base}.restore-${stamp}`), previous: path.join(parent, `${base}.before-restore-${stamp}`) };
}

/**
 * libpq environment variables for a postgres:// URL (same as pg-env.mjs), so pg_dump, pg_restore
 * and psql get the password from the environment, never from a command line.
 */
export function pgEnvFromUrl(raw) {
  const u = new URL(raw);
  const vars = {
    PGHOST: decodeURIComponent(u.hostname || "localhost"),
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
  };
  const ssl = u.searchParams.get("sslmode");
  if (ssl) vars.PGSSLMODE = ssl;
  return Object.fromEntries(Object.entries(vars).filter(([, v]) => v));
}

/** Allowed values for backup_runs.trigger (short, lower case, no free text from operators). */
export function isValidTrigger(trigger) {
  return typeof trigger === "string" && /^[a-z][a-z0-9-]{0,30}$/.test(trigger);
}

/** Command-line flags: `--name value` and bare `--flag`. Unknown flags are reported. */
export function parseArgs(argv, { values = [], flags = [] } = {}) {
  const out = { _unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._unknown.push(a);
      continue;
    }
    const key = a.slice(2);
    if (flags.includes(key)) out[key] = true;
    else if (values.includes(key)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) out._unknown.push(`${a} (needs a value)`);
      else {
        out[key] = v;
        i += 1;
      }
    } else out._unknown.push(a);
  }
  return out;
}
