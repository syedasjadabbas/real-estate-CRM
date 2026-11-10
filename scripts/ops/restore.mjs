// Restore the CRM database and uploaded files from one backup folder, with Super Admin approval
// and safety checks (scripts/ops/RESTORE.md). Run on the server, in an agreed maintenance window,
// with the app STOPPED and the production environment loaded:
//
//   NODE_ENV=production node scripts/ops/restore.mjs --backup <folder name, e.g. 20261110T020000Z> \
//     --confirm-database <database name> --approved-by <super admin email> [--dry-run]
//
// The approving Super Admin's CRM password is read from a hidden prompt (or the first line of piped
// stdin); it is never printed, logged or stored. Nothing is touched until every check passes:
//   1. NODE_ENV=production and --confirm-database matches the connected database;
//   2. the approver is an ACTIVE super_admin and the password matches (argon2, the app's hashes);
//   3. the folder is a backup folder inside BACKUP_DIR and SHA256SUMS verifies;
//   4. pg_restore, psql, pg_dump, bash and tar are available;
//   5. the backup's migrations are not newer than this code's (drizzle/meta/_journal.json);
//   6. the storage archive lists one top-level folder and no unsafe paths;
//   7. no other session is connected to the database (the app is stopped);
//   8. (not in --dry-run) a fresh pre-restore backup of the current database and files succeeds.
// Then: the archive is extracted next to FILE_STORAGE_DIR; the database is replaced in ONE
// transaction (any error rolls everything back); migrations newer than the backup are applied; the
// current storage folder is renamed to `<name>.before-restore-<time>` (kept) and the restored one
// takes its place. `--dry-run` runs checks 1–7 and changes nothing.
//
// Every attempt (refused, dry run, failed, succeeded) is recorded in backup_runs (kind restore) and
// audit_logs. The restored database replaces those tables, so the records written during this run
// are written again into the restored database afterwards.
import { spawn } from "node:child_process";
import { access, constants, lstat, mkdir, readdir, readFile, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { verify } from "@node-rs/argon2";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import {
  backupFolderPath,
  checkArchiveListing,
  checkBackupConfig,
  checkConnections,
  checkMigrationCompat,
  dumpMigrations,
  isBackupFolderName,
  journalMigrations,
  parseArgs,
  pgEnvFromUrl,
  sanitizeMessage,
  storageRestoreNames,
} from "./backup-lib.mjs";
import { APP_DIR, closeInterruptedRuns, RunRecorder, runBackup, runCommand, tryLock, unlock, verifyBackupFolder } from "./backup-run.mjs";

const USAGE = "usage: NODE_ENV=production node scripts/ops/restore.mjs --backup <folder name> --confirm-database <name> --approved-by <super admin email> [--dry-run]";

/** Reads a line without echoing it (TTY), or the first line of piped stdin. */
function readSecret(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    if (process.stdin.isTTY) {
      process.stdout.write(prompt);
      rl._writeToOutput = () => {};
    }
    let done = false;
    rl.once("line", (line) => {
      done = true;
      rl.close();
      if (process.stdin.isTTY) process.stdout.write("\n");
      resolve(line);
    });
    rl.once("close", () => {
      if (!done) resolve("");
    });
  });
}

/** True only for an active super_admin whose password matches. Never says which part failed. */
export async function verifySuperAdmin(client, email, password) {
  const {
    rows: [user],
  } = await client.query("select id, email, password_hash, role, status from users where lower(email) = lower($1)", [email]);
  let ok = false;
  try {
    ok = Boolean(user && password) && (await verify(user.password_hash, password));
  } catch {
    ok = false;
  }
  return ok && user.role === "super_admin" && user.status === "active" ? { id: user.id, email: user.email } : null;
}

/**
 * Replaces the database from the dump in ONE transaction: the current `public` and `drizzle`
 * schemas are dropped and the dump's SQL is applied; COMMIT is sent only after pg_restore has
 * produced the whole script without error. Any failure leaves the database as it was.
 */
export function restoreDatabase(dumpPath, env) {
  return new Promise((resolve) => {
    let psqlErr = "";
    let restoreErr = "";
    let committed = false;
    let restoreCode = null;
    const psql = spawn("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], { env, stdio: ["pipe", "ignore", "pipe"] });
    const restore = spawn("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", "-f", "-", dumpPath], { env, stdio: ["ignore", "pipe", "pipe"] });
    psql.stderr.on("data", (d) => (psqlErr += d));
    restore.stderr.on("data", (d) => (restoreErr += d));
    psql.stdin.on("error", () => {}); // psql stopped early (an error): reported through its exit code
    psql.on("error", (e) => (psqlErr += e.message));
    restore.on("error", (e) => (restoreErr += e.message));
    psql.stdin.write("BEGIN;\nDROP SCHEMA IF EXISTS drizzle CASCADE;\nDROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n");
    restore.stdout.pipe(psql.stdin, { end: false });
    restore.on("close", (code) => {
      restoreCode = code;
      if (code === 0) {
        committed = true;
        psql.stdin.end("COMMIT;\n");
      } else {
        // No COMMIT: psql reaches the end of its input and the open transaction is rolled back.
        psql.stdin.end();
      }
    });
    psql.on("close", (code) => {
      if (code !== 0) restore.kill();
      const finish = () =>
        resolve({
          ok: code === 0 && restoreCode === 0 && committed,
          message: sanitizeMessage(`${restoreErr}\n${psqlErr}`.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ")),
        });
      if (restoreCode === null) restore.once("close", finish);
      else finish();
    });
  });
}

/** Writes the run and audit records of this restore into the (restored) database again. */
async function replayJournal(client, journal) {
  const ids = [...new Set(journal.map((e) => e.actorId).filter(Boolean))];
  const known = new Set(ids.length ? (await client.query("select id from users where id = any($1::uuid[])", [ids])).rows.map((r) => r.id) : []);
  for (const e of journal) {
    const actor = e.actorId && known.has(e.actorId) ? e.actorId : null;
    if (e.type === "run") {
      await client.query(
        "insert into backup_runs (id, kind, status, trigger, location, size_bytes, message, actor_id, started_at, finished_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing",
        [e.id, e.kind, e.status, e.trigger, e.location, e.sizeBytes, e.message, actor, e.startedAt, e.finishedAt],
      );
    } else {
      await client.query("insert into audit_logs (actor_id, action, entity, entity_id, before, after, ip) values ($1, $2, 'backup_run', $3, null, $4, null)", [
        actor,
        e.action,
        e.entityId,
        JSON.stringify(e.after),
      ]);
    }
  }
  return known;
}

async function countMissingFiles(client, storageDir) {
  const { rows } = await client.query("select storage_key from files");
  let missing = 0;
  for (const { storage_key: key } of rows) {
    const s = await lstat(path.join(storageDir, key)).catch(() => null);
    if (!s || !s.isFile()) missing += 1;
  }
  return { total: rows.length, missing };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ["backup", "confirm-database", "approved-by"], flags: ["dry-run", "help"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const dryRun = Boolean(args["dry-run"]);
  const label = dryRun ? "restore (dry run)" : "restore";
  const fail = (message) => {
    console.error(`${label}: FAILED – ${sanitizeMessage(message, 2000)}`);
    process.exitCode = 1;
  };

  // ── 1. Arguments, environment and the target database ────────────────────────────────────────
  if (args._unknown.length) return fail(`unknown arguments: ${args._unknown.join(" ")}. ${USAGE}`);
  if (process.env.NODE_ENV !== "production") return fail("NODE_ENV must be production. Nothing was changed.");
  const name = args.backup;
  const confirm = args["confirm-database"];
  const approver = args["approved-by"]?.trim().toLowerCase();
  if (!name || !confirm || !approver) return fail(`--backup, --confirm-database and --approved-by are all required. ${USAGE}`);
  if (!isBackupFolderName(name)) return fail("--backup must be a backup folder name such as 20261110T020000Z (not a path). Nothing was changed.");
  const env = process.env;
  const configProblems = checkBackupConfig(env, APP_DIR);
  if (configProblems.length) return fail(`${configProblems.join(" ")} Nothing was changed.`);

  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    return fail(`cannot connect to the database: ${error.message}`);
  }
  let locked = false;
  try {
    const {
      rows: [{ db }],
    } = await client.query("select current_database() as db");
    if (db !== confirm) return fail(`connected to database "${db}", but --confirm-database says "${confirm}". Nothing was changed.`);

    locked = await tryLock(client);
    if (!locked) return fail("another backup, retention or restore run is in progress. Nothing was changed.");
    await closeInterruptedRuns(client);

    // ── 2. Super Admin approval ────────────────────────────────────────────────────────────────
    const recorder = new RunRecorder(client);
    const password = await readSecret(`CRM password for ${approver} (Super Admin approving this restore, not shown): `);
    const admin = await verifySuperAdmin(client, approver, password);
    if (!admin) {
      const run = await recorder.start("restore", dryRun ? "dry-run" : "manual", name);
      await recorder.finish(run, { status: "failed", message: `Restore refused: Super Admin approval failed for ${approver} (not an active Super Admin, or wrong password). Nothing was changed.` });
      return fail("Super Admin approval failed (not an active Super Admin, or wrong password). Nothing was changed.");
    }
    recorder.actorId = admin.id;
    const run = await recorder.start("restore", dryRun ? "dry-run" : "manual", name);
    const refuse = async (message) => {
      await recorder.finish(run, { status: "failed", message: `Restore refused (approved by ${admin.email}): ${message} Nothing was changed.` });
      fail(`${message} Nothing was changed.`);
    };

    // ── 3–7. Checks (all of them run, then every failure is reported together) ──────────────────
    const checks = [];
    const check = (label, ok, detail) => checks.push({ label, ok, detail });
    const folder = backupFolderPath(env.BACKUP_DIR, name);
    try {
      await verifyBackupFolder(folder);
      check("Backup folder and checksums", true, `${name} verified`);
    } catch (error) {
      check("Backup folder and checksums", false, error.message);
    }

    const tools = {};
    for (const tool of ["pg_restore", "psql", "pg_dump", "tar", "bash"]) {
      tools[tool] = (await runCommand(tool, ["--version"], { echo: false })).code === 0;
    }
    const missingTools = Object.keys(tools).filter((t) => !tools[t]);
    check("Tools", missingTools.length === 0, missingTools.length ? `not found: ${missingTools.join(", ")}` : "pg_restore, psql, pg_dump, tar and bash found");

    const folderOk = checks[0].ok;
    if (folderOk && tools.pg_restore) {
      const dump = path.join(folder, "database.dump");
      const listing = await runCommand("pg_restore", ["--list", dump], { echo: false });
      const migrations = await runCommand("pg_restore", ["--data-only", "--schema=drizzle", "--table=__drizzle_migrations", "-f", "-", dump], { echo: false });
      const journal = journalMigrations(JSON.parse(await readFile(path.join(APP_DIR, "drizzle/meta/_journal.json"), "utf8")));
      if (listing.code !== 0 || migrations.code !== 0) check("Database dump readable", false, sanitizeMessage(`${listing.stderr} ${migrations.stderr}`) || "pg_restore could not read the dump");
      else {
        check("Database dump readable", true, "pg_restore read the archive");
        const compat = checkMigrationCompat(dumpMigrations(migrations.stdout), journal);
        check("Migrations not newer than this code", compat.ok, compat.reason);
      }
    } else check("Database dump readable", false, "skipped: the folder or pg_restore failed its check");

    let archiveTop = null;
    if (folderOk && tools.tar) {
      const list = await runCommand("tar", ["-tzf", path.join(folder, "storage.tar.gz")], { echo: false });
      const result = list.code === 0 ? checkArchiveListing(list.stdout) : { ok: false, reason: sanitizeMessage(list.stderr) || "tar could not read the archive" };
      archiveTop = result.ok ? result.top : null;
      check("Storage archive", result.ok, result.reason);
    } else check("Storage archive", false, "skipped: the folder or tar failed its check");

    const storage = storageRestoreNames(env.FILE_STORAGE_DIR, new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"));
    try {
      await access(storage.parent, constants.W_OK);
      const exists = await lstat(storage.staging).catch(() => null);
      check("Storage location", !exists, exists ? `${storage.staging} already exists` : `files will be restored into ${env.FILE_STORAGE_DIR}`);
    } catch {
      check("Storage location", false, `${storage.parent} is not writable`);
    }

    const {
      rows: [{ n }],
    } = await client.query("select count(*)::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()");
    const conn = checkConnections(n);
    check("App stopped", conn.ok, conn.reason);

    for (const c of checks) console.log(`${label}: ${c.ok ? "ok    " : "FAILED"} ${c.label}: ${c.detail}`);
    const failed = checks.filter((c) => !c.ok);
    if (failed.length) return await refuse(`${failed.length} check(s) failed: ${failed.map((c) => `${c.label} (${c.detail})`).join("; ")}.`);

    if (dryRun) {
      const message = `Dry run of ${name} into ${db} approved by ${admin.email}: all ${checks.length} checks passed. Nothing was restored. A real restore first takes a pre-restore backup.`;
      await recorder.finish(run, { status: "succeeded", message });
      console.log(`${label}: OK – ${message}`);
      return;
    }

    // ── 8. Pre-restore backup ──────────────────────────────────────────────────────────────────
    console.log(`${label}: taking a pre-restore backup of the current database and files…`);
    const pre = await runBackup(recorder, { trigger: "pre-restore", env });
    if (!pre.ok) return await refuse(`the pre-restore backup failed: ${pre.message}`);
    console.log(`${label}: pre-restore backup ${pre.name} written`);

    // ── Extract files to a staging folder (nothing live is touched yet) ──────────────────────
    await mkdir(storage.staging, { mode: 0o700 });
    const extract = await runCommand("tar", ["-xzf", path.join(folder, "storage.tar.gz"), "-C", storage.staging, "--no-same-owner"], { echo: false });
    const extracted = path.join(storage.staging, archiveTop);
    const extractedInfo = await lstat(extracted).catch(() => null);
    if (extract.code !== 0 || !extractedInfo?.isDirectory()) {
      await rm(storage.staging, { recursive: true, force: true }); // only the staging copy made above
      return await refuse(`extracting the storage archive failed: ${sanitizeMessage(extract.stderr) || "no folder extracted"}`);
    }

    // ── Replace the database in one transaction ──────────────────────────────────────────────
    console.log(`${label}: restoring the database (one transaction)…`);
    const restored = await restoreDatabase(path.join(folder, "database.dump"), { ...process.env, ...pgEnvFromUrl(env.DATABASE_URL) });
    if (!restored.ok) {
      await rm(storage.staging, { recursive: true, force: true }); // only the staging copy made above
      await recorder.finish(run, {
        status: "failed",
        message: `Restore of ${name} failed and was rolled back (approved by ${admin.email}): ${restored.message}. The database and files are unchanged. Pre-restore backup: ${pre.name}.`,
      });
      return fail(`the database restore failed and was rolled back: ${restored.message}. The database and files are unchanged.`);
    }

    // ── From here the database is the backup's. Apply newer migrations, then swap the files ────
    const problems = [];
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
    try {
      await migrate(drizzle(pool), { migrationsFolder: path.join(APP_DIR, "drizzle") });
    } catch (error) {
      problems.push(`migrations failed: ${error.message}`);
    } finally {
      await pool.end();
    }

    let previousKept = null;
    try {
      if (await lstat(env.FILE_STORAGE_DIR).catch(() => null)) {
        await rename(env.FILE_STORAGE_DIR, storage.previous);
        previousKept = storage.previous;
      }
      await rename(extracted, env.FILE_STORAGE_DIR);
      if ((await readdir(storage.staging)).length === 0) await rmdir(storage.staging);
    } catch (error) {
      problems.push(`files were not swapped: ${error.message} (restored files are in ${storage.staging})`);
    }

    // ── Records into the restored database, then a short verification ────────────────────────
    let summary = "";
    try {
      const known = await replayJournal(client, recorder.journal);
      if (!known.has(admin.id)) recorder.actorId = null;
      const counts = [];
      for (const t of ["users", "leads", "clients", "bookings", "files", "audit_logs"]) {
        const r = await client.query(`select count(*)::int as n from ${t}`).catch(() => null);
        if (r) counts.push(`${t} ${r.rows[0].n}`);
      }
      const files = await countMissingFiles(client, env.FILE_STORAGE_DIR);
      if (files.missing) problems.push(`${files.missing} of ${files.total} stored files are missing from the restored folder`);
      summary = `Rows: ${counts.join(", ")}.`;
    } catch (error) {
      problems.push(`recording or verification failed: ${error.message}`);
    }

    const message = `Restored ${name} into ${db} (approved by ${admin.email}). Pre-restore backup: ${pre.name}.${previousKept ? ` Previous files kept at ${path.basename(previousKept)}.` : ""} ${summary}${problems.length ? ` Problems: ${problems.join("; ")}.` : ""}`;
    try {
      await recorder.finish(run, { status: problems.length ? "failed" : "succeeded", message });
    } catch (error) {
      problems.push(`the restore run could not be recorded: ${error.message}`);
    }
    if (problems.length) return fail(`${message} Fix the problems before starting the app.`);
    console.log(`${label}: OK – ${message} Start the app (systemctl start mz-crm), sign in and check recent leads and one recording.`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (locked) await unlock(client);
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
