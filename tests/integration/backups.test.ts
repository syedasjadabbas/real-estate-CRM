import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeInterruptedRuns, RunRecorder, runPrune, tryLock, unlock } from "../../scripts/ops/backup-run.mjs";
import { verifySuperAdmin } from "../../scripts/ops/restore.mjs";
import { getBackupOverview } from "@/modules/backups/service";
import { auditLogs, backupRuns } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

const PASSWORD = "correct-horse-battery"; // seedFixture's password for every user
const testUrl = process.env.TEST_DATABASE_URL ?? "";
const dbName = testUrl ? new URL(testUrl).pathname.slice(1) : "";

/** Runs the real restore script against the TEST database (never the development one). */
function restore(args: string[], { env = {}, input = "" }: { env?: Record<string, string>; input?: string } = {}) {
  const r = spawnSync(process.execPath, ["scripts/ops/restore.mjs", ...args], {
    input,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", NODE_ENV: "production", DATABASE_URL: testUrl, ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const COMPLETE = ["database.dump", "storage.tar.gz", "SHA256SUMS"];

describe.skipIf(!hasTestDb)("backups: runs, retention, restore guards and the Backups page (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let client: pg.Client;
  let f: Fixture;
  let dir: string;
  let backupDir: string;
  let storageDir: string;

  beforeAll(async () => {
    ({ db, close } = connectTestDb());
    client = new pg.Client({ connectionString: testUrl });
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
    await close();
  });
  beforeEach(async () => {
    await resetDb(db);
    await db.execute(sql`TRUNCATE backup_runs`);
    f = await seedFixture(db);
    dir = await mkdtemp(path.join(tmpdir(), "mz-backups-"));
    backupDir = path.join(dir, "backups");
    storageDir = path.join(dir, "data", "storage");
    await mkdir(backupDir, { recursive: true });
    await mkdir(storageDir, { recursive: true });
    return async () => {
      await rm(dir, { recursive: true, force: true }); // the temporary folder this test created
    };
  });

  async function makeFolder(name: string, files = COMPLETE) {
    await mkdir(path.join(backupDir, name));
    for (const file of files) await writeFile(path.join(backupDir, name, file), "x");
  }

  it("records a run with its audit entry (no IP, no credentials) and marks interrupted runs as failed", async () => {
    const recorder = new RunRecorder(client);
    const run = await recorder.start("backup", "manual");
    await recorder.finish(run, { status: "failed", message: "connection to postgres://crm:s3cret@db/mz failed", location: "20261110T020000Z" });
    const [row] = await db.select().from(backupRuns).where(eq(backupRuns.id, run.id));
    expect(row).toMatchObject({ kind: "backup", status: "failed", trigger: "manual", location: "20261110T020000Z" });
    expect(row.message).not.toContain("s3cret");
    expect(row.finishedAt).toBeInstanceOf(Date);
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, run.id));
    expect(log).toMatchObject({ action: "backup.backup.failed", entity: "backup_run", actorId: null, ip: null });
    expect(JSON.stringify(log)).not.toContain("s3cret");

    const stuck = await recorder.start("prune", "schedule");
    expect(await closeInterruptedRuns(client)).toBe(1);
    const [after] = await db.select().from(backupRuns).where(eq(backupRuns.id, stuck.id));
    expect(after).toMatchObject({ status: "failed", message: expect.stringMatching(/Interrupted/) });
  });

  it("holds one lock for backup, retention and restore", async () => {
    const other = new pg.Client({ connectionString: testUrl });
    await other.connect();
    try {
      expect(await tryLock(client)).toBe(true);
      expect(await tryLock(other)).toBe(false);
      await unlock(client);
      expect(await tryLock(other)).toBe(true);
      await unlock(other);
    } finally {
      await other.end();
    }
  });

  it("retention keeps 30 daily and 12 monthly copies, removes only timestamped backup folders and records a prune run", async () => {
    const now = new Date("2026-11-10T02:00:00Z");
    await makeFolder("20261109T210000Z"); // 02:00 on 10 Nov, Pakistan time: today
    await makeFolder("20261109T020000Z"); // 07:00 on 9 Nov: newest copy of 9 Nov
    await makeFolder("20261108T210000Z"); // 02:00 on 9 Nov: second copy of that day, removed
    await makeFolder("20261020T020000Z"); // inside the 30-day window, and October's newest
    await makeFolder("20261001T020000Z"); // outside the window, not October's newest: removed
    await makeFolder("20260930T020000Z"); // outside the window: kept as September's newest
    await makeFolder("20260915T020000Z"); // older September copy: removed
    await makeFolder("20251220T020000Z"); // December 2025, the 12th month back: kept
    await makeFolder("20251120T020000Z"); // 13 months back: removed
    await makeFolder("20260901T020000Z", ["database.dump"]); // incomplete and old: removed
    await mkdir(path.join(backupDir, "20250101T020000Z.keep"));
    await mkdir(path.join(backupDir, "manual-copy"));
    await writeFile(path.join(backupDir, "20240101T020000Z"), "a file, not a folder");
    const env = { BACKUP_DIR: backupDir };

    const result = await runPrune(new RunRecorder(client), { trigger: "schedule", env, now });
    expect(result.ok).toBe(true);
    expect([...(result.removed ?? [])].sort()).toEqual(["20251120T020000Z", "20260901T020000Z", "20260915T020000Z", "20261001T020000Z", "20261108T210000Z"]);
    expect((await readdir(backupDir)).sort()).toEqual([
      "20240101T020000Z",
      "20250101T020000Z.keep",
      "20251220T020000Z",
      "20260930T020000Z",
      "20261020T020000Z",
      "20261109T020000Z",
      "20261109T210000Z",
      "manual-copy",
    ]);
    const [row] = await db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(1);
    expect(row).toMatchObject({ kind: "prune", status: "succeeded", location: null, message: expect.stringMatching(/30 daily, 12 monthly\): removed 5/) });
  });

  it("retention keeps the newest complete backup even when everything is old, and refuses bad settings", async () => {
    await makeFolder("20250101T020000Z");
    await makeFolder("20250102T020000Z", ["database.dump"]);
    const now = new Date("2026-11-10T02:00:00Z");
    const ok = await runPrune(new RunRecorder(client), { trigger: "manual", env: { BACKUP_DIR: backupDir }, now });
    expect(ok.removed).toEqual(["20250102T020000Z"]);
    expect(await readdir(backupDir)).toEqual(["20250101T020000Z"]);

    const bad = await runPrune(new RunRecorder(client), { trigger: "manual", env: { BACKUP_DIR: backupDir, BACKUP_KEEP_DAILY: "-3" }, now });
    expect(bad.ok).toBe(false);
    const legacy = await runPrune(new RunRecorder(client), { trigger: "manual", env: { BACKUP_DIR: backupDir, BACKUP_RETENTION_DAYS: "1" }, now });
    expect(legacy).toMatchObject({ ok: false, message: expect.stringMatching(/no longer used/) });
    expect(await readdir(backupDir)).toEqual(["20250101T020000Z"]);
  });

  it("approves restores only for an active Super Admin with the right password", async () => {
    expect(await verifySuperAdmin(client, "SA@test.local", PASSWORD)).toMatchObject({ email: "sa@test.local" });
    expect(await verifySuperAdmin(client, "sa@test.local", "wrong-password")).toBeNull();
    expect(await verifySuperAdmin(client, "sa@test.local", "")).toBeNull();
    expect(await verifySuperAdmin(client, "manager@test.local", PASSWORD)).toBeNull();
    expect(await verifySuperAdmin(client, "nobody@test.local", PASSWORD)).toBeNull();
    await client.query("update users set status = 'inactive' where email = 'sa@test.local'");
    expect(await verifySuperAdmin(client, "sa@test.local", PASSWORD)).toBeNull();
  });

  it("restore refuses without production, confirmation, a valid folder name or approval, and records refusals", async () => {
    const env = { BACKUP_DIR: backupDir, FILE_STORAGE_DIR: storageDir };
    const base = ["--backup", "20261110T020000Z", "--confirm-database", dbName, "--approved-by", "sa@test.local"];

    expect(restore(base, { env: { ...env, NODE_ENV: "development" }, input: `${PASSWORD}\n` })).toMatchObject({ code: 1, out: expect.stringMatching(/NODE_ENV must be production/) });
    const wrong = restore(["--backup", "20261110T020000Z", "--confirm-database", "mz_crm", "--approved-by", "sa@test.local"], { env, input: `${PASSWORD}\n` });
    expect(wrong).toMatchObject({ code: 1, out: expect.stringMatching(/Nothing was changed/) });
    expect(restore(["--backup", "../etc", "--confirm-database", dbName, "--approved-by", "sa@test.local"], { env, input: `${PASSWORD}\n` }).out).toMatch(/not a path/);
    expect(await db.select().from(backupRuns)).toEqual([]);

    const denied = restore(base, { env, input: "wrong-password\n" });
    expect(denied.code).toBe(1);
    expect(denied.out).toMatch(/approval failed/);
    expect(denied.out).not.toContain("wrong-password");
    const [row] = await db.select().from(backupRuns);
    expect(row).toMatchObject({ kind: "restore", status: "failed", actorId: null, message: expect.stringMatching(/approval failed/) });
    expect(JSON.stringify(await db.select().from(auditLogs))).not.toContain("wrong-password");
  });

  it("a dry run with a damaged backup lists the failed checks, changes nothing and records the attempt", async () => {
    await makeFolder("20261110T020000Z");
    await writeFile(path.join(backupDir, "20261110T020000Z", "SHA256SUMS"), `${"0".repeat(64)}  database.dump\n${"0".repeat(64)}  storage.tar.gz\n`);
    const r = restore(["--backup", "20261110T020000Z", "--confirm-database", dbName, "--approved-by", "sa@test.local", "--dry-run"], {
      env: { BACKUP_DIR: backupDir, FILE_STORAGE_DIR: storageDir },
      input: `${PASSWORD}\n`,
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAILED Backup folder and checksums: checksum mismatch/);
    expect(r.out).toMatch(/Nothing was changed/);
    expect(r.out).not.toContain(PASSWORD);
    const [row] = await db.select().from(backupRuns);
    expect(row).toMatchObject({ kind: "restore", status: "failed", trigger: "dry-run", location: "20261110T020000Z", actorId: f.actors.superAdmin.id });
    expect((await readdir(backupDir)).sort()).toEqual(["20261110T020000Z"]);
    expect(await readdir(path.dirname(storageDir))).toEqual(["storage"]);
  });

  it("the Backups page is Super Admin only and warns when there is no recent successful backup", async () => {
    await expect(getBackupOverview(db, f.actors.manager, {})).rejects.toBeInstanceOf(AppError);
    const admin = { ...f.actors.superAdmin, role: "admin" as const };
    await expect(getBackupOverview(db, admin, {})).rejects.toBeInstanceOf(AppError);

    const empty = await getBackupOverview(db, f.actors.superAdmin, {});
    expect(empty).toMatchObject({ runs: [], lastBackup: null, health: { state: "none" }, retention: { daily: 30, monthly: 12, isDefault: true }, offServerCopy: false });

    const old = new Date(Date.now() - 30 * 3_600_000);
    await db.insert(backupRuns).values({ kind: "backup", status: "succeeded", trigger: "schedule", location: "20261108T020000Z", sizeBytes: 2048, startedAt: old, finishedAt: old });
    await db.insert(backupRuns).values({ kind: "backup", status: "failed", trigger: "schedule", message: "Backup failed (exit 1): disk full" });
    const stale = await getBackupOverview(db, f.actors.superAdmin, { BACKUP_KEEP_DAILY: "45", BACKUP_REMOTE: "x" });
    expect(stale.health.state).toBe("stale");
    expect(stale.lastBackup).toMatchObject({ location: "20261108T020000Z", sizeBytes: 2048 });
    expect(stale.failuresLast7Days).toBe(1);
    expect(stale.runs.map((r) => r.status)).toEqual(["failed", "succeeded"]);
    expect(stale).toMatchObject({ retention: { daily: 45, monthly: 12, isDefault: false }, offServerCopy: true });

    await db.insert(backupRuns).values({ kind: "backup", status: "succeeded", trigger: "manual", location: "20261110T020000Z", finishedAt: new Date(), actorId: f.actors.superAdmin.id });
    const fresh = await getBackupOverview(db, f.actors.superAdmin, {});
    expect(fresh.health.state).toBe("ok");
    expect(fresh.lastBackup?.location).toBe("20261110T020000Z");
    expect(fresh.runs[0]).toMatchObject({ actorName: "Super Admin" });
  });
});
