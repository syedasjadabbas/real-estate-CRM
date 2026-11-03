import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authenticate } from "@/server/auth/login";
import { auditLogs, cities, leadSources, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { connectTestDb, hasTestDb, resetDb } from "../support/db";

const PASSWORD = "first-admin-password";
const testUrl = process.env.TEST_DATABASE_URL ?? "";
const dbName = testUrl ? new URL(testUrl).pathname.slice(1) : "";

/** Runs the real script against the TEST database (never the development one). */
function run(args: string[], { env = {}, input = "" }: { env?: Record<string, string>; input?: string } = {}) {
  const r = spawnSync(process.execPath, ["scripts/setup-production.mjs", ...args], {
    input,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", NODE_ENV: "production", DATABASE_URL: testUrl, ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe.skipIf(!hasTestDb)("scripts/setup-production.mjs (P1, test database)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let dir: string;
  let lookups: string;

  beforeAll(async () => {
    ({ db, close } = connectTestDb());
    dir = await mkdtemp(path.join(tmpdir(), "mz-setup-"));
    lookups = path.join(dir, "lookups.json");
    await writeFile(lookups, JSON.stringify({ leadSources: ["Website", "Walk in", "website"], cities: ["Islamabad"], budgetRanges: [], lostReasons: ["Not interested"] }));
  });
  afterAll(async () => {
    await close();
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => resetDb(db));

  it("refuses without NODE_ENV=production, without confirmation, or with the wrong database name", () => {
    expect(run(["--confirm-database", dbName, "--lookups", lookups], { env: { NODE_ENV: "development" } })).toMatchObject({ code: 1 });
    expect(run(["--lookups", lookups]).out).toMatch(/--confirm-database/);
    const wrong = run(["--confirm-database", "mz_crm", "--lookups", lookups]);
    expect(wrong.code).toBe(1);
    expect(wrong.out).toMatch(/Nothing was changed/);
  });

  it("adds client lookup lists once (idempotent, duplicates ignored)", async () => {
    expect(run(["--confirm-database", dbName, "--lookups", lookups]).code).toBe(0);
    expect(run(["--confirm-database", dbName, "--lookups", lookups]).out).toMatch(/lead_sources: 0 added, 2 already present/);
    expect((await db.select().from(leadSources)).map((r) => r.name).sort()).toEqual(["Walk in", "Website"]);
    expect((await db.select().from(cities)).map((r) => r.name)).toEqual(["Islamabad"]);
    // A name already present in another letter case is not added again.
    await db.update(cities).set({ name: "ISLAMABAD" });
    expect(run(["--confirm-database", dbName, "--lookups", lookups]).out).toMatch(/cities: 0 added, 1 already present/);
    expect((await db.select().from(cities)).map((r) => r.name)).toEqual(["ISLAMABAD"]);
  });

  it("creates the first Super Admin from a piped password, never echoes it, and refuses a second", async () => {
    const r = run(["--confirm-database", dbName, "--admin-name", "Owner Person", "--admin-email", "Owner@Company.test"], { input: `${PASSWORD}\n` });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain(PASSWORD);
    const [u] = await db.select().from(users).where(eq(users.email, "owner@company.test"));
    expect(u).toMatchObject({ name: "Owner Person", role: "super_admin", status: "active" });
    expect(u.passwordHash).not.toContain(PASSWORD);
    expect((await authenticate(db, { email: "owner@company.test", password: PASSWORD }, { ip: "10.8.0.1" })).userId).toBe(u.id);
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, u.id));
    expect(JSON.stringify(log)).not.toContain(PASSWORD);

    const again = run(["--confirm-database", dbName, "--admin-name", "Other", "--admin-email", "other@company.test"], { input: `${PASSWORD}\n` });
    expect(again.code).toBe(1);
    expect(again.out).toMatch(/already exists/);
  });

  it("refuses a short password and creates nothing", async () => {
    const r = run(["--confirm-database", dbName, "--admin-name", "Owner", "--admin-email", "owner@company.test"], { input: "short\n" });
    expect(r.code).toBe(1);
    expect(await db.select().from(users)).toEqual([]);
  });
});
