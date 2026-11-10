import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as lib from "../../scripts/ops/backup-lib.mjs";
import { canViewBackups } from "@/modules/backups/policy";
import * as rules from "@/modules/backups/rules";
import type { Role } from "@/server/auth/types";

const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];
const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const NOW = new Date("2026-11-10T02:00:00Z");
const BACKUP_DIR = path.resolve("/var/backups/mz-crm");
const HEX = "a".repeat(64);
const folder = (name: string, extra: Partial<{ isDirectory: boolean; complete: boolean }> = {}) => ({ name, isDirectory: true, complete: true, ...extra });

describe("backups page policy", () => {
  it("is Super Admin only", () => {
    expect(roles.filter((role) => canViewBackups({ role }))).toEqual(["super_admin"]);
  });

  it("shows the Backups tab only when asked (Super Admins), keeping the other tabs", () => {
    const src = read("src/features/audit/components/audit-controls.tsx");
    expect(src).toMatch(/showBackups \? \[\{ key: "backups"/);
    for (const page of ["security", "cities", "audit-log"]) {
      expect(read(`src/app/(app)/dashboard/settings/${page}/page.tsx`)).toMatch(/showBackups=\{canViewBackups\(actor\)\}/);
    }
  });

  it("has no restore, download or delete action on the page", () => {
    const src = read("src/app/(app)/dashboard/settings/backups/page.tsx");
    expect(src).not.toMatch(/"use server"|<form|<button|href=\{?["'`][^"'`]*download/i);
    expect(src).toMatch(/canViewBackups\(actor\)/);
  });
});

describe("backup folder names", () => {
  it("accepts exactly the backup.sh timestamp format", () => {
    expect(lib.isBackupFolderName("20261110T020000Z")).toBe(true);
    expect(lib.parseBackupStamp("20261110T020000Z")?.toISOString()).toBe("2026-11-10T02:00:00.000Z");
  });

  it.each(["", "20261110T020000", "20261110T020000Z.old", "x20261110T020000Z", "../20261110T020000Z", "20261340T020000Z", "20260230T020000Z", "20261110T250000Z", "2026-11-10", "storage", ".", ".."])(
    "rejects %j",
    (name) => {
      expect(lib.isBackupFolderName(name)).toBe(false);
    },
  );

  it("builds paths only directly inside BACKUP_DIR", () => {
    expect(lib.backupFolderPath(BACKUP_DIR, "20261110T020000Z")).toBe(path.join(BACKUP_DIR, "20261110T020000Z"));
    expect(() => lib.backupFolderPath(BACKUP_DIR, "../etc")).toThrow();
    expect(() => lib.backupFolderPath(BACKUP_DIR, "20261110T020000Z/..")).toThrow();
    expect(() => lib.backupFolderPath(BACKUP_DIR, path.join(BACKUP_DIR, "20261110T020000Z"))).toThrow();
    expect(() => lib.backupFolderPath("relative/backups", "20261110T020000Z")).toThrow(/absolute/);
    expect(() => lib.backupFolderPath("", "20261110T020000Z")).toThrow();
  });
});

describe("retention settings", () => {
  it("defaults to 30 daily and 12 monthly copies", () => {
    expect(lib.parseRetention({})).toEqual({ daily: 30, monthly: 12 });
    expect(rules.readRetention({})).toEqual({ daily: 30, monthly: 12, error: null, isDefault: true });
  });

  it("reads the daily and monthly counts", () => {
    expect(lib.parseRetention({ BACKUP_KEEP_DAILY: "7", BACKUP_KEEP_MONTHLY: "0" })).toEqual({ daily: 7, monthly: 0 });
    expect(rules.readRetention({ BACKUP_KEEP_DAILY: "7", BACKUP_KEEP_MONTHLY: "0" })).toMatchObject({ daily: 7, monthly: 0, error: null, isDefault: false });
    expect(lib.parseRetention({ BACKUP_KEEP_MONTHLY: "24" })).toEqual({ daily: 30, monthly: 24 });
  });

  it.each([
    { BACKUP_KEEP_DAILY: "0" },
    { BACKUP_KEEP_DAILY: "-1" },
    { BACKUP_KEEP_DAILY: "1.5" },
    { BACKUP_KEEP_DAILY: "x" },
    { BACKUP_KEEP_DAILY: "3651" },
    { BACKUP_KEEP_MONTHLY: "-1" },
    { BACKUP_KEEP_MONTHLY: "2.5" },
    { BACKUP_KEEP_MONTHLY: "1201" },
  ])("rejects %j in the runner and on the page", (env) => {
    expect(lib.parseRetention(env).error).toBeTruthy();
    expect(rules.readRetention(env).error).toBeTruthy();
  });

  it.each([{ BACKUP_RETENTION_DAYS: "14" }, { BACKUP_RETENTION_COUNT: "5" }, { BACKUP_RETENTION_DAYS: "30", BACKUP_KEEP_DAILY: "30" }])(
    "refuses the old setting %j and names the replacements",
    (env) => {
      expect(lib.parseRetention(env).error).toMatch(/no longer used.*BACKUP_KEEP_DAILY.*BACKUP_KEEP_MONTHLY/);
      expect(rules.readRetention(env).error).toMatch(/no longer used/);
    },
  );

  it("keeps the runner and the app on the same limits", () => {
    expect([lib.DEFAULT_KEEP_DAILY, lib.DEFAULT_KEEP_MONTHLY, lib.MIN_KEEP_DAILY, lib.MAX_KEEP_DAILY, lib.MIN_KEEP_MONTHLY, lib.MAX_KEEP_MONTHLY, lib.LEGACY_RETENTION_VARS]).toEqual([
      rules.DEFAULT_KEEP_DAILY,
      rules.DEFAULT_KEEP_MONTHLY,
      rules.MIN_KEEP_DAILY,
      rules.MAX_KEEP_DAILY,
      rules.MIN_KEEP_MONTHLY,
      rules.MAX_KEEP_MONTHLY,
      rules.LEGACY_RETENTION_VARS,
    ]);
  });
});

describe("retention selection", () => {
  // A backup every night at 02:00 Pakistan time (21:00 UTC the evening before) for 400 nights.
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const nightly = Array.from({ length: 400 }, (_, i) => folder(stamp(new Date(NOW.getTime() - 5 * 3_600_000 - i * 86_400_000))));
  const names = (list: { name: string }[]) => list.map((f) => f.name);

  it("keeps the newest backup of each of the last 30 days", () => {
    const { keep } = lib.selectForPruning(nightly, { daily: 30, monthly: 0, now: NOW });
    expect(keep).toEqual(names(nightly.slice(0, 30)));
  });

  it("also keeps the newest backup of each of the last 12 months, and nothing older", () => {
    const { keep, remove } = lib.selectForPruning(nightly, { daily: 30, monthly: 12, now: NOW });
    const months = new Set(keep.map((n) => lib.retentionMonth(lib.parseBackupStamp(n)!)));
    expect(months.size).toBe(12);
    expect([...months].sort()[0]).toBe("2025-12");
    // Beyond the daily window, exactly one per month: the last night of that month.
    const older = keep.slice(30);
    expect(older).toHaveLength(10); // November and October 2026 are already covered by the daily copies
    for (const name of older) {
      const at = lib.parseBackupStamp(name)!;
      const next = new Date(at.getTime() + 86_400_000);
      expect(lib.retentionMonth(next)).not.toBe(lib.retentionMonth(at));
    }
    expect(keep.length + remove.length).toBe(400);
  });

  it("uses the default 30 daily and 12 monthly copies", () => {
    expect(lib.selectForPruning(nightly, { now: NOW }).keep).toEqual(lib.selectForPruning(nightly, { daily: 30, monthly: 12, now: NOW }).keep);
  });

  it("keeps only the newest complete copy of a day, and recent incomplete folders until they leave the window", () => {
    const entries = [
      folder("20261109T210000Z"), // 02:00 on 10 Nov, Pakistan time
      folder("20261110T013000Z"), // 06:30 on 10 Nov: newest of the day
      folder("20261109T180000Z", { complete: false }), // 23:00 on 9 Nov, failed
      folder("20260901T020000Z", { complete: false }), // failed long ago
    ];
    const { keep, remove } = lib.selectForPruning(entries, { daily: 30, monthly: 0, now: NOW });
    expect(keep).toEqual(["20261110T013000Z", "20261109T180000Z"]);
    expect(remove.sort()).toEqual(["20260901T020000Z", "20261109T210000Z"]);
  });

  it("never keeps an incomplete folder as the day's copy", () => {
    const entries = [folder("20261110T013000Z", { complete: false }), folder("20261109T210000Z")];
    const { keep, reasons } = lib.selectForPruning(entries, { daily: 1, monthly: 0, now: NOW });
    expect(keep.sort()).toEqual(["20261109T210000Z", "20261110T013000Z"]);
    expect(reasons.get("20261109T210000Z")).toContain("daily");
    expect(reasons.get("20261110T013000Z")).toEqual(["recent-incomplete"]);
  });

  it("always keeps the newest complete backup, even when every folder is old", () => {
    const old = [folder("20240101T020000Z", { complete: false }), folder("20240102T020000Z"), folder("20240103T020000Z", { complete: false })];
    const { remove, keep } = lib.selectForPruning(old, { daily: 30, monthly: 12, now: NOW });
    expect(keep).toEqual(["20240102T020000Z"]);
    expect(remove.sort()).toEqual(["20240101T020000Z", "20240103T020000Z"]);
  });

  it("never selects other names, files, symlinks or future-dated folders", () => {
    const entries = [
      folder("storage"),
      folder("20250101T020000Z.keep"),
      folder("20250101T020000Z", { isDirectory: false }),
      folder("29991231T000000Z"),
      folder("20250105T020000Z"),
      folder("20250104T020000Z"),
    ];
    const { remove, keep } = lib.selectForPruning(entries, { daily: 1, monthly: 0, now: NOW });
    expect(remove).toEqual(["20250104T020000Z"]);
    expect(keep).toEqual(["20250105T020000Z"]);
  });

  it("does nothing on an empty folder", () => {
    expect(lib.selectForPruning([], { now: NOW })).toMatchObject({ remove: [], keep: [] });
  });

  it("describes the rule in plain words", () => {
    expect(lib.describeRetention({ daily: 30, monthly: 12 })).toMatch(/each of the last 30 days and from each of the last 12 months/);
    expect(lib.describeRetention({ daily: 7, monthly: 0 })).not.toMatch(/month/);
    expect(rules.describeRetention({ daily: 30, monthly: 12 })).toBe("30 daily, 12 monthly");
    expect(rules.describeRetention({ daily: 7, monthly: 0 })).toBe("7 daily");
  });
});

describe("backup configuration checks", () => {
  const app = path.resolve("/srv/mz-crm");
  const ok = { DATABASE_URL: "postgres://u@h/db", FILE_STORAGE_DIR: path.resolve("/srv/mz-crm-data/storage"), BACKUP_DIR };

  it("accepts a sound configuration", () => {
    expect(lib.checkBackupConfig(ok, app)).toEqual([]);
  });

  it("refuses missing, relative, root, in-app or overlapping backup folders and bad retention", () => {
    expect(lib.checkBackupConfig({}, app)).toHaveLength(3);
    expect(lib.checkBackupConfig({ ...ok, BACKUP_DIR: "backups" }, app).join()).toMatch(/absolute/);
    expect(lib.checkBackupConfig({ ...ok, BACKUP_DIR: path.parse(BACKUP_DIR).root }, app).join()).toMatch(/root/);
    expect(lib.checkBackupConfig({ ...ok, BACKUP_DIR: path.join(app, "backups") }, app).join()).toMatch(/outside the app/);
    expect(lib.checkBackupConfig({ ...ok, BACKUP_DIR: path.join(ok.FILE_STORAGE_DIR, "b") }, app).join()).toMatch(/must not contain/);
    expect(lib.checkBackupConfig({ ...ok, BACKUP_KEEP_DAILY: "x" }, app).join()).toMatch(/BACKUP_KEEP_DAILY/);
    expect(lib.checkBackupConfig({ ...ok, BACKUP_RETENTION_DAYS: "14" }, app).join()).toMatch(/no longer used/);
  });
});

describe("checksums", () => {
  it("parses sha256sum output for exactly the two backup files", () => {
    const map = lib.parseChecksums(`${HEX}  database.dump\n${"B".repeat(64)} *storage.tar.gz\n`);
    expect(map.get("database.dump")).toBe(HEX);
    expect(map.get("storage.tar.gz")).toBe("b".repeat(64));
  });

  it.each([`${HEX}  database.dump\n`, `${HEX}  database.dump\n${HEX}  storage.tar.gz\n${HEX}  other\n`, `nothex  database.dump\n${HEX}  storage.tar.gz`, `${HEX}  database.dump\n${HEX}  database.dump\n`])(
    "rejects a wrong list %#",
    (text) => {
      expect(() => lib.parseChecksums(text)).toThrow();
    },
  );
});

describe("restore safety checks", () => {
  const code = { count: 29, latest: 1794309995958 };

  it("refuses a backup made by newer code", () => {
    expect(lib.checkMigrationCompat({ count: 29, latest: code.latest }, code).ok).toBe(true);
    expect(lib.checkMigrationCompat({ count: 25, latest: 1793000000000 }, code)).toMatchObject({ ok: true });
    expect(lib.checkMigrationCompat({ count: 30, latest: code.latest + 1 }, code).ok).toBe(false);
    expect(lib.checkMigrationCompat({ count: 29, latest: code.latest + 1 }, code).ok).toBe(false);
    expect(lib.checkMigrationCompat({ count: 0, latest: 0 }, code).ok).toBe(false);
    expect(lib.checkMigrationCompat(null, code).ok).toBe(false);
  });

  it("reads the migration count from pg_restore SQL and the journal", () => {
    const sql = [
      "SET statement_timeout = 0;",
      "COPY drizzle.__drizzle_migrations (id, hash, created_at) FROM stdin;",
      "1\tabc\t1793000000000",
      "2\tdef\t1794309995958",
      "\\.",
      "",
    ].join("\n");
    expect(lib.dumpMigrations(sql)).toEqual({ count: 2, latest: 1794309995958 });
    expect(lib.dumpMigrations("SET x = 1;")).toBeNull();
    expect(lib.journalMigrations({ entries: [{ when: 5 }, { when: 9 }] })).toEqual({ count: 2, latest: 9 });
    const journal = lib.journalMigrations(JSON.parse(read("drizzle/meta/_journal.json")));
    expect(journal.count).toBeGreaterThan(0);
  });

  it("checks the storage archive listing before extracting", () => {
    expect(lib.checkArchiveListing("storage/\nstorage/a/b.mp3\n")).toMatchObject({ ok: true, top: "storage" });
    expect(lib.checkArchiveListing("./storage/\n./storage/x\n")).toMatchObject({ ok: true, top: "storage" });
    expect(lib.checkArchiveListing("").ok).toBe(false);
    expect(lib.checkArchiveListing("storage/\nother/x\n").ok).toBe(false);
    expect(lib.checkArchiveListing("/etc/passwd\n").ok).toBe(false);
    expect(lib.checkArchiveListing("storage/../../x\n").ok).toBe(false);
  });

  it("refuses while other sessions are connected", () => {
    expect(lib.checkConnections(0).ok).toBe(true);
    expect(lib.checkConnections(2)).toMatchObject({ ok: false, reason: expect.stringMatching(/Stop the app/) });
  });

  it("keeps the previous storage folder next to the live one", () => {
    const names = lib.storageRestoreNames(path.resolve("/srv/data/storage"), "20261110T030000Z");
    expect(names.previous).toBe(path.join(path.resolve("/srv/data"), "storage.before-restore-20261110T030000Z"));
    expect(names.staging).toBe(path.join(path.resolve("/srv/data"), ".storage.restore-20261110T030000Z"));
  });
});

describe("no secrets in run records", () => {
  it("redacts connection strings and password variables, and bounds the length", () => {
    const msg = lib.sanitizeMessage("pg_dump: error: connection to postgres://crm:s3cret@db:5432/mz failed\nPGPASSWORD=s3cret PASSWORD: hunter2");
    expect(msg).not.toMatch(/s3cret|hunter2/);
    expect(msg).toMatch(/postgres:\/\/\[redacted\]/);
    expect(msg).not.toMatch(/\n/);
    expect(lib.sanitizeMessage("x".repeat(900))).toHaveLength(lib.MAX_MESSAGE_LENGTH);
  });

  it("stores sizes that fit the integer column only", () => {
    expect(lib.toSizeColumn(1024)).toBe(1024);
    expect(lib.toSizeColumn(3_000_000_000)).toBeNull();
    expect(lib.toSizeColumn(-1)).toBeNull();
  });

  it("builds libpq variables without putting the password on a command line", () => {
    expect(lib.pgEnvFromUrl("postgres://crm:p%40ss@db.local:6543/mz?sslmode=require")).toEqual({
      PGHOST: "db.local",
      PGPORT: "6543",
      PGUSER: "crm",
      PGPASSWORD: "p@ss",
      PGDATABASE: "mz",
      PGSSLMODE: "require",
    });
    for (const file of ["scripts/ops/backup-run.mjs", "scripts/ops/restore.mjs"]) {
      const src = read(file);
      expect(src).not.toMatch(/console\.(log|error)\([^)]*(password|DATABASE_URL)\b(?!\s*is not set)/i);
      expect(src).not.toMatch(/--password|PGPASSWORD=/);
    }
  });

  it("accepts only short trigger words", () => {
    expect(lib.isValidTrigger("schedule")).toBe(true);
    expect(lib.isValidTrigger("pre-restore")).toBe(true);
    expect(lib.isValidTrigger("Schedule")).toBe(false);
    expect(lib.isValidTrigger("a b")).toBe(false);
    expect(lib.isValidTrigger("x".repeat(40))).toBe(false);
  });

  it("deletes only through the guarded retention path and never touches tables", () => {
    const runner = read("scripts/ops/backup-run.mjs");
    expect(runner.match(/\brm\(/g)).toHaveLength(1);
    expect(runner).toMatch(/const full = backupFolderPath\(env\.BACKUP_DIR, name\);[\s\S]{0,200}await rm\(full, \{ recursive: true \}\)/);
    expect(runner.toLowerCase()).not.toMatch(/delete from|truncate|drop /);
    const restore = read("scripts/ops/restore.mjs");
    // The only rm calls remove the staging copy the restore itself just extracted.
    expect(restore.match(/\brm\((\w+(?:\.\w+)?)/g)).toEqual(["rm(storage.staging", "rm(storage.staging"]);
    expect(restore.toLowerCase()).not.toMatch(/delete from|truncate/);
  });
});

describe("Backups page status", () => {
  it("warns when there is no backup or the last one is older than 26 hours", () => {
    expect(rules.backupHealth(null)).toEqual({ state: "none", ageHours: null });
    expect(rules.backupHealth(25 * 3_600_000).state).toBe("ok");
    expect(rules.backupHealth(26 * 3_600_000).state).toBe("ok");
    expect(rules.backupHealth(26 * 3_600_000 + 1).state).toBe("stale");
    expect(rules.STALE_AFTER_HOURS).toBe(26);
  });

  it("formats ages and sizes", () => {
    expect(rules.formatAge(0.5)).toBe("30 minutes");
    expect(rules.formatAge(5)).toBe("5 hours");
    expect(rules.formatAge(76)).toBe("3 days 4 hours");
    expect(rules.formatSize(null)).toBe("—");
    expect(rules.formatSize(1536)).toBe("1.5 KB");
    expect(lib.formatBytes(1536)).toBe("1.5 KB");
  });
});
