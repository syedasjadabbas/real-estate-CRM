// Automated backup with retention and run records (SECURITY_AND_PRIVACY.md §9; scripts/ops/RESTORE.md).
//
//   node scripts/ops/backup-run.mjs [--trigger schedule|manual] [--no-prune]
//   node scripts/ops/backup-run.mjs --restore-check <backup folder name> [--trigger manual]
//
// 1. Records a `backup_runs` row (kind backup, status running).
// 2. Runs scripts/ops/backup.sh (database dump + FILE_STORAGE_DIR archive + SHA256SUMS, optional
//    rsync to BACKUP_REMOTE), then verifies the checksums and the folder size.
// 3. Marks the run succeeded or failed (location = the folder name only, never a path or URL).
// 4. Only after a successful backup: applies retention (BACKUP_KEEP_DAILY, default 30, and
//    BACKUP_KEEP_MONTHLY, default 12) to timestamped folders directly inside BACKUP_DIR, and records a
//    `prune` run. Nothing else is ever deleted; the newest complete backup is always kept.
// 5. Prints one line: `backup: OK – …` or `backup: FAILED – …`, and exits non-zero on failure.
//
// `--restore-check` runs scripts/ops/restore-check.sh on one folder (scratch database only; the
// live database is only read) and records a `restore_check` run.
//
// Every run writes an audit_logs row (actor: none, ip: NULL). Runs never overlap: backup, prune and
// restore share one advisory lock. Credentials never reach a command line, a run record or the log.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import {
  BACKUP_FILES,
  BACKUP_LOCK_KEY,
  backupFolderPath,
  checkBackupConfig,
  describeRetention,
  formatBytes,
  isBackupFolderName,
  isValidTrigger,
  parseArgs,
  parseChecksums,
  parseRetention,
  sanitizeMessage,
  selectForPruning,
  toSizeColumn,
} from "./backup-lib.mjs";

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Runs a command without a shell, streaming its output through (prefixed lines are not needed:
 * the scripts print their own `backup:` prefix). Resolves with the exit code and the captured
 * output; never rejects for a non-zero exit.
 */
export function runCommand(cmd, args, { env = process.env, cwd = APP_DIR, input, echo = true } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(cmd, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: 127, stdout, stderr: String(error?.message ?? error) });
      return;
    }
    child.stdout.on("data", (d) => {
      stdout += d;
      if (echo) process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (echo) process.stderr.write(d);
    });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
}

/** Checks a backup folder: the three files are regular files and SHA256SUMS matches. Returns the size. */
export async function verifyBackupFolder(folder) {
  const info = await lstat(folder).catch(() => null);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) throw new Error(`${path.basename(folder)} is not a backup folder.`);
  let size = 0;
  for (const f of BACKUP_FILES) {
    const s = await lstat(path.join(folder, f)).catch(() => null);
    if (!s || !s.isFile()) throw new Error(`${path.basename(folder)} is incomplete: ${f} is missing.`);
    size += s.size;
  }
  const sums = parseChecksums(await readFile(path.join(folder, "SHA256SUMS"), "utf8"));
  for (const [file, expected] of sums) {
    if ((await sha256File(path.join(folder, file))) !== expected) throw new Error(`checksum mismatch for ${file} in ${path.basename(folder)}.`);
  }
  return size;
}

/** The last meaningful lines of a command's error output, sanitised. */
function lastLines(text, n = 3) {
  return sanitizeMessage(
    String(text)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-n)
      .join(" | "),
  );
}

/**
 * Writes backup_runs and audit rows, and keeps a copy of everything it wrote in `journal`, so a
 * restore can write the same records into the restored database (which replaces these rows).
 */
export class RunRecorder {
  constructor(client, { actorId = null } = {}) {
    this.client = client;
    this.actorId = actorId;
    this.journal = [];
  }

  async start(kind, trigger, location = null) {
    const {
      rows: [row],
    } = await this.client.query("insert into backup_runs (kind, status, trigger, location, actor_id) values ($1, 'running', $2, $3, $4) returning id, started_at", [
      kind,
      trigger,
      location,
      this.actorId,
    ]);
    const entry = { type: "run", id: row.id, kind, trigger, location, status: "running", sizeBytes: null, message: null, actorId: this.actorId, startedAt: row.started_at, finishedAt: null };
    this.journal.push(entry);
    return entry;
  }

  async finish(entry, { status, location = entry.location, sizeBytes = null, message }) {
    const clean = sanitizeMessage(message);
    const {
      rows: [row],
    } = await this.client.query("update backup_runs set status = $2, location = $3, size_bytes = $4, message = $5, finished_at = now() where id = $1 returning finished_at", [
      entry.id,
      status,
      location,
      toSizeColumn(sizeBytes),
      clean,
    ]);
    Object.assign(entry, { status, location, sizeBytes: toSizeColumn(sizeBytes), message: clean, finishedAt: row?.finished_at ?? new Date() });
    await this.audit(`backup.${entry.kind}.${status}`, entry.id, { kind: entry.kind, trigger: entry.trigger, status, location, sizeBytes: toSizeColumn(sizeBytes), message: clean });
    return entry;
  }

  /** Audit rows from scripts have no request, so ip is NULL. */
  async audit(action, entityId, after) {
    await this.client.query("insert into audit_logs (actor_id, action, entity, entity_id, before, after, ip) values ($1, $2, 'backup_run', $3, null, $4, null)", [
      this.actorId,
      action,
      entityId,
      JSON.stringify(after),
    ]);
    this.journal.push({ type: "audit", action, entityId, after, actorId: this.actorId });
  }
}

/** Marks runs left `running` by an interrupted process as failed. Call only while holding the lock. */
export async function closeInterruptedRuns(client) {
  const res = await client.query("update backup_runs set status = 'failed', finished_at = now(), message = 'Interrupted: the run stopped before it finished.' where status = 'running'");
  return res.rowCount ?? 0;
}

export async function tryLock(client) {
  const {
    rows: [{ locked }],
  } = await client.query("select pg_try_advisory_lock($1) as locked", [BACKUP_LOCK_KEY]);
  return locked;
}

export async function unlock(client) {
  await client.query("select pg_advisory_unlock($1)", [BACKUP_LOCK_KEY]).catch(() => {});
}

/**
 * One backup: backup.sh, then checksum verification. Returns `{ ok, name, size, message }`.
 * `env` must include the whole process environment (PATH, …): backup.sh runs with it.
 * The caller must hold the lock.
 */
export async function runBackup(recorder, { trigger, env = process.env }) {
  const run = await recorder.start("backup", trigger);
  const problems = checkBackupConfig(env, APP_DIR);
  if (problems.length) {
    const message = `Backup not started: ${problems.join(" ")}`;
    await recorder.finish(run, { status: "failed", message });
    return { ok: false, message };
  }
  const result = await runCommand("bash", [path.join(APP_DIR, "scripts/ops/backup.sh")], { env });
  const wrote = /^backup: wrote (.+)$/m.exec(result.stdout);
  const name = wrote ? path.basename(wrote[1].trim()) : null;
  if (result.code !== 0 || !name || !isBackupFolderName(name)) {
    const message = `Backup failed (exit ${result.code}): ${lastLines(result.stderr || result.stdout) || "no output"}`;
    await recorder.finish(run, { status: "failed", location: name && isBackupFolderName(name) ? name : null, message });
    return { ok: false, message };
  }
  let size;
  try {
    size = await verifyBackupFolder(backupFolderPath(env.BACKUP_DIR, name));
  } catch (error) {
    const message = `Backup written but not usable: ${error.message}`;
    await recorder.finish(run, { status: "failed", location: name, message });
    return { ok: false, name, message };
  }
  const remote = /^backup: copied to /m.test(result.stdout);
  const message = `Backup ${name} written (${formatBytes(size)}), checksums verified${remote ? ", copied off-server" : env.BACKUP_REMOTE ? "" : ", no off-server copy (BACKUP_REMOTE not set)"}.`;
  await recorder.finish(run, { status: "succeeded", location: name, sizeBytes: size, message });
  return { ok: true, name, size, message };
}

/** Reads BACKUP_DIR for retention: real directories only, with whether all three files exist. */
export async function listBackupFolders(backupDir) {
  const out = [];
  for (const d of await readdir(backupDir, { withFileTypes: true })) {
    if (!isBackupFolderName(d.name)) continue;
    const full = backupFolderPath(backupDir, d.name);
    const info = await lstat(full).catch(() => null);
    const isDirectory = Boolean(info && info.isDirectory() && !info.isSymbolicLink());
    let complete = false;
    if (isDirectory) {
      const files = await Promise.all(BACKUP_FILES.map((f) => lstat(path.join(full, f)).catch(() => null)));
      complete = files.every((s) => s && s.isFile());
    }
    out.push({ name: d.name, isDirectory, complete });
  }
  return out;
}

/**
 * Retention: removes only folders chosen by selectForPruning. The caller must hold the lock.
 * @param {RunRecorder} recorder
 * @param {{ trigger: string, env?: Record<string, string | undefined>, now?: Date }} options
 */
export async function runPrune(recorder, { trigger, env = process.env, now = new Date() }) {
  const run = await recorder.start("prune", trigger);
  const retention = parseRetention(env);
  if (retention.error || !env.BACKUP_DIR) {
    const message = `Retention not applied: ${retention.error ?? "BACKUP_DIR is not set."}`;
    await recorder.finish(run, { status: "failed", message });
    return { ok: false, message };
  }
  const removed = [];
  try {
    const entries = await listBackupFolders(env.BACKUP_DIR);
    const { remove, keep } = selectForPruning(entries, { ...retention, now });
    for (const name of remove) {
      const full = backupFolderPath(env.BACKUP_DIR, name);
      const info = await lstat(full);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      await rm(full, { recursive: true });
      removed.push(name);
    }
    const message = `Retention (${retention.daily} daily, ${retention.monthly} monthly): removed ${removed.length}${removed.length ? ` (${removed.join(", ")})` : ""}, kept ${keep.length}.`;
    await recorder.finish(run, { status: "succeeded", message });
    return { ok: true, removed, kept: keep.length, message };
  } catch (error) {
    const message = `Retention failed after removing ${removed.length}: ${error.message}`;
    await recorder.finish(run, { status: "failed", message });
    return { ok: false, removed, message };
  }
}

/** restore-check.sh on one folder (scratch database only). The caller must hold the lock. */
export async function runRestoreCheck(recorder, { trigger, name, env = process.env }) {
  const run = await recorder.start("restore_check", trigger, isBackupFolderName(name) ? name : null);
  let folder;
  try {
    folder = backupFolderPath(env.BACKUP_DIR, name);
    await verifyBackupFolder(folder);
  } catch (error) {
    const message = `Restore check not started: ${error.message}`;
    await recorder.finish(run, { status: "failed", message });
    return { ok: false, message };
  }
  const result = await runCommand("bash", [path.join(APP_DIR, "scripts/ops/restore-check.sh"), folder], { env });
  const ok = result.code === 0 && /^restore-check: OK$/m.test(result.stdout);
  const message = ok ? `Restore check of ${name} passed: row counts compared and every stored file is in the archive.` : `Restore check of ${name} failed (exit ${result.code}): ${lastLines(`${result.stdout}\n${result.stderr}`)}`;
  await recorder.finish(run, { status: ok ? "succeeded" : "failed", message });
  return { ok, message };
}

function loadDevEnv() {
  if (process.env.NODE_ENV === "production") return;
  try {
    process.loadEnvFile(path.join(APP_DIR, ".env.local"));
  } catch {
    // rely on the shell environment
  }
}

const USAGE = "usage: node scripts/ops/backup-run.mjs [--trigger schedule|manual] [--no-prune] | --restore-check <folder name>";

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ["trigger", "restore-check"], flags: ["no-prune", "help"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const fail = (message) => {
    console.error(`backup: FAILED – ${sanitizeMessage(message)}`);
    process.exitCode = 1;
  };
  if (args._unknown.length) return fail(`unknown arguments: ${args._unknown.join(" ")}. ${USAGE}`);
  const trigger = args.trigger ?? "manual";
  if (!isValidTrigger(trigger)) return fail("--trigger must be a short lower-case word such as schedule or manual.");

  loadDevEnv();
  if (!process.env.DATABASE_URL) return fail("DATABASE_URL is not set.");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    return fail(`cannot connect to the database: ${error.message}`);
  }
  const recorder = new RunRecorder(client);
  let locked = false;
  try {
    locked = await tryLock(client);
    if (!locked) {
      const run = await recorder.start(args["restore-check"] ? "restore_check" : "backup", trigger);
      await recorder.finish(run, { status: "failed", message: "Not started: another backup, retention or restore run is in progress." });
      return fail("another backup, retention or restore run is in progress; nothing was done.");
    }
    const interrupted = await closeInterruptedRuns(client);
    if (interrupted) console.log(`backup: marked ${interrupted} interrupted run(s) as failed`);

    if (args["restore-check"]) {
      const check = await runRestoreCheck(recorder, { trigger, name: args["restore-check"] });
      if (!check.ok) return fail(check.message);
      console.log(`backup: OK – ${check.message}`);
      return;
    }

    const backup = await runBackup(recorder, { trigger });
    if (!backup.ok) return fail(`${backup.message} Retention was not applied.`);
    if (args["no-prune"]) {
      console.log(`backup: OK – ${backup.message} Retention skipped (--no-prune).`);
      return;
    }
    const prune = await runPrune(recorder, { trigger });
    if (!prune.ok) return fail(`${backup.message} But ${prune.message}`);
    console.log(`backup: OK – ${backup.message} ${prune.message} ${describeRetention(parseRetention(process.env))}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (locked) await unlock(client);
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
