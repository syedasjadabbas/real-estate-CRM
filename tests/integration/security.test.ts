import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pruneSigninLogs } from "../../scripts/jobs/prune-signin-logs.mjs";
import { getRetentionSettings, getRetentionStatus, updateRetentionSettings } from "@/modules/security/service";
import { CLEANUP_ENABLED_KEY, LAST_RUN_KEY, RETENTION_MONTHS_KEY } from "@/modules/security/retention";
import { readProxyConfig, resolveClientIp } from "@/server/auth/client-ip";
import { authenticate } from "@/server/auth/login";
import { createSession, loadActor } from "@/server/auth/session-store";
import { appSettings, auditLogs, sessions, signinLogs, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

const monthsAgo = (n: number, extraMs = 0) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return new Date(d.getTime() - extraMs);
};

describe.skipIf(!hasTestDb)("Production readiness (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let client: pg.Client;
  let f: Fixture;
  let admin: Actor;
  let accountant: Actor;

  beforeAll(async () => {
    ({ db, close } = connectTestDb());
    client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
    await close();
  });
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const mk = async (role: "admin" | "accountant", email: string) => {
      const [u] = await db.insert(users).values({ name: role, email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    admin = await mk("admin", "admin@test.local");
    accountant = await mk("accountant", "acc@test.local");
  });

  /** Rows 13 months, 11 months and 1 day old for agent1, plus one 13-month row for agent2. */
  const seedAges = async () => {
    await db.insert(signinLogs).values([
      { userId: f.actors.agent1.id, event: "sign_in", at: monthsAgo(13) },
      { userId: f.actors.agent1.id, event: "sign_out", at: monthsAgo(11) },
      { userId: f.actors.agent1.id, event: "sign_in", at: new Date(Date.now() - 86_400_000) },
      { userId: f.actors.agent2.id, event: "sign_in", at: monthsAgo(13) },
    ]);
    await db.insert(auditLogs).values({ actorId: null, action: "test.old", entity: "test", createdAt: monthsAgo(24) });
  };
  const counts = async () => {
    const [r] = await db.select({
      signins: sql<number>`(select count(*)::int from signin_logs)`,
      audits: sql<number>`(select count(*)::int from audit_logs)`,
      sessions: sql<number>`(select count(*)::int from sessions)`,
      users: sql<number>`(select count(*)::int from users)`,
    }).from(sql`(select 1) as one`);
    return r;
  };

  describe("sign-in log retention job", () => {
    it("deletes nothing while automatic deletion is off (the default), and reports what is eligible", async () => {
      await seedAges();
      const before = await counts();
      const r = await pruneSigninLogs(client);
      expect(r).toMatchObject({ status: "disabled", enabled: false, retentionMonths: 12, eligible: 2, deleted: 0 });
      expect(await counts()).toEqual(before);
      const [last] = await db.select().from(appSettings).where(eq(appSettings.key, LAST_RUN_KEY));
      expect(JSON.parse(last.value)).toMatchObject({ status: "disabled", eligible: 2, deleted: 0 });
      // No execution audit row unless something was actually deleted by an enabled run.
      expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "system.signin_log_retention"))).toHaveLength(0);
    });

    it("dry run never deletes, even when enabled", async () => {
      await seedAges();
      await updateRetentionSettings(db, admin, { cleanupEnabled: true, confirmEnable: true });
      const r = await pruneSigninLogs(client, { dryRun: true });
      expect(r).toMatchObject({ status: "dry_run", enabled: true, eligible: 2, deleted: 0 });
      expect((await counts()).signins).toBe(4);
    });

    it("when enabled, deletes only sign-in logs past the cutoff; audit logs, sessions and users are untouched", async () => {
      await seedAges();
      await createSession(db, f.actors.hr.id, { ip: null }); // adds a recent sign-in and a session
      await updateRetentionSettings(db, admin, { cleanupEnabled: true, confirmEnable: true });
      const before = await counts();
      const r = await pruneSigninLogs(client, { batchSize: 1 });
      expect(r).toMatchObject({ status: "completed", retentionMonths: 12, eligible: 2, deleted: 2 });
      const after = await counts();
      expect(after.signins).toBe(before.signins - 2);
      expect(after.sessions).toBe(before.sessions);
      expect(after.users).toBe(before.users);
      expect(after.audits).toBe(before.audits + 1); // only the execution record was added
      const remaining = await db.select().from(signinLogs);
      expect(remaining.every((l) => l.at > monthsAgo(12))).toBe(true);
      expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "test.old"))).toHaveLength(1);
      const [run] = await db.select().from(auditLogs).where(eq(auditLogs.action, "system.signin_log_retention"));
      expect(run).toMatchObject({ actorId: null, entity: "signin_logs" });
      expect(run.after).toMatchObject({ retentionMonths: 12, eligible: 2, deleted: 2 });
    });

    it("is idempotent and keeps a row just inside the cutoff", async () => {
      await db.insert(signinLogs).values([
        { userId: f.actors.agent1.id, event: "sign_in", at: monthsAgo(3, 60_000) },
        { userId: f.actors.agent1.id, event: "sign_in", at: new Date(monthsAgo(3).getTime() + 60_000) },
      ]);
      await updateRetentionSettings(db, admin, { retentionMonths: 3, cleanupEnabled: true, confirmEnable: true });
      expect((await pruneSigninLogs(client)).deleted).toBe(1);
      expect((await pruneSigninLogs(client)).deleted).toBe(0);
      expect(await db.select().from(signinLogs)).toHaveLength(1);
    });

    it("never overlaps: a second run while the lock is held is skipped", async () => {
      await seedAges();
      await updateRetentionSettings(db, admin, { cleanupEnabled: true, confirmEnable: true });
      const holder = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
      await holder.connect();
      try {
        await holder.query("select pg_advisory_lock($1)", [740_215_001]);
        expect(await pruneSigninLogs(client)).toMatchObject({ status: "skipped", deleted: 0 });
        expect((await counts()).signins).toBe(4);
      } finally {
        await holder.query("select pg_advisory_unlock($1)", [740_215_001]);
        await holder.end();
      }
      expect((await pruneSigninLogs(client)).deleted).toBe(2);
    });

    it("refuses to delete when the stored retention value is outside 3–120 months", async () => {
      await seedAges();
      await db.insert(appSettings).values([
        { key: RETENTION_MONTHS_KEY, value: "1" },
        { key: CLEANUP_ENABLED_KEY, value: "true" },
      ]);
      expect(await pruneSigninLogs(client)).toMatchObject({ status: "invalid_setting", deleted: 0 });
      expect((await counts()).signins).toBe(4);
    });
  });

  describe("retention settings", () => {
    it("defaults to 12 months with deletion off", async () => {
      expect(await getRetentionSettings(db)).toMatchObject({ retentionMonths: 12, isDefault: true, cleanupEnabled: false, lastRun: null });
    });

    it("lets only super admin and admin read or change them", async () => {
      expect(await errorCode(getRetentionStatus(db, f.actors.superAdmin))).toBe("ok");
      expect(await errorCode(updateRetentionSettings(db, f.actors.superAdmin, { retentionMonths: 24 }))).toBe("ok");
      expect(await errorCode(updateRetentionSettings(db, admin, { retentionMonths: 18 }))).toBe("ok");
      for (const actor of [f.actors.manager, f.actors.agent1, f.actors.hr, accountant]) {
        expect(await errorCode(getRetentionStatus(db, actor))).toBe("FORBIDDEN");
        expect(await errorCode(updateRetentionSettings(db, actor, { retentionMonths: 6 }))).toBe("FORBIDDEN");
        expect(await errorCode(updateRetentionSettings(db, actor, { cleanupEnabled: true, confirmEnable: true }))).toBe("FORBIDDEN");
      }
      expect((await getRetentionSettings(db)).retentionMonths).toBe(18);
    });

    it("validates the range and needs explicit confirmation to enable deletion", async () => {
      for (const v of [2, 121, 6.5]) expect(await errorCode(updateRetentionSettings(db, admin, { retentionMonths: v }))).toBe("VALIDATION_FAILED");
      expect(await errorCode(updateRetentionSettings(db, admin, { cleanupEnabled: true }))).toBe("VALIDATION_FAILED");
      expect((await getRetentionSettings(db)).cleanupEnabled).toBe(false);
      expect(await errorCode(updateRetentionSettings(db, admin, { cleanupEnabled: true, confirmEnable: true }))).toBe("ok");
      expect(await errorCode(updateRetentionSettings(db, admin, { cleanupEnabled: false }))).toBe("ok");
    });

    it("audits each change and reports the cutoff and eligible count", async () => {
      await seedAges();
      expect((await updateRetentionSettings(db, admin, { retentionMonths: 12 })).changed).toEqual(["retentionMonths"]);
      expect((await updateRetentionSettings(db, admin, { retentionMonths: 12 })).changed).toEqual([]);
      await updateRetentionSettings(db, admin, { cleanupEnabled: true, confirmEnable: true });
      const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "app.setting"));
      expect(logs.map((l) => [l.entityId, l.before, l.after])).toEqual(
        expect.arrayContaining([
          [RETENTION_MONTHS_KEY, { value: "" }, { value: "12" }],
          [CLEANUP_ENABLED_KEY, { value: "false" }, { value: "true" }],
        ]),
      );
      const s = await getRetentionStatus(db, admin);
      expect(s).toMatchObject({ retentionMonths: 12, cleanupEnabled: true, eligible: 2, total: 4 });
      expect(Math.abs(s.cutoff.getTime() - monthsAgo(12).getTime())).toBeLessThan(2 * 86_400_000);
    });
  });

  describe("client IP and the login rate limit (security)", () => {
    const behindProxy = readProxyConfig({ NODE_ENV: "production", TRUST_PROXY: "true" });
    const noProxy = readProxyConfig({ NODE_ENV: "production" });
    const metaFor = (xff: string, config = behindProxy) => ({ ip: resolveClientIp(new Headers({ "x-forwarded-for": xff }), config).ip, userAgent: "test" });

    it("cannot be bypassed by rotating spoofed X-Forwarded-For values behind the proxy", async () => {
      const email = "ratelimit-proxy@test.local";
      await db.insert(users).values({ name: "Rate Limit", email, role: "agent", passwordHash: "x" });
      for (let i = 0; i < 5; i++) {
        // Each attempt claims a different address; the proxy appends the real one (203.0.113.50).
        expect(await errorCode(authenticate(db, { email, password: "wrong" }, metaFor(`6.6.6.${i}, 203.0.113.50`)))).toBe("UNAUTHENTICATED");
      }
      expect(await errorCode(authenticate(db, { email, password: "wrong" }, metaFor("7.7.7.7, 203.0.113.50")))).toBe("RATE_LIMITED");
    });

    it("cannot be bypassed without a proxy either: spoofed values are ignored entirely", async () => {
      const email = "ratelimit-direct@test.local";
      await db.insert(users).values({ name: "Rate Limit", email, role: "agent", passwordHash: "x" });
      for (let i = 0; i < 5; i++) {
        expect(await errorCode(authenticate(db, { email, password: "wrong" }, metaFor(`6.6.6.${i}`, noProxy)))).toBe("UNAUTHENTICATED");
      }
      expect(await errorCode(authenticate(db, { email, password: "wrong" }, metaFor("8.8.8.8", noProxy)))).toBe("RATE_LIMITED");
    });

    it("stores only the verified IP on sign-in and in the session", async () => {
      const spoofed = metaFor("6.6.6.6, 203.0.113.77");
      const { token } = await authenticate(db, { email: "agent1@test.local", password: f.passwords.agent1 }, spoofed);
      expect(token).toBeTruthy();
      const [log] = await db.select().from(signinLogs).where(eq(signinLogs.userId, f.actors.agent1.id));
      expect(log.ip).toBe("203.0.113.77");
      const [session] = await db.select().from(sessions).where(eq(sessions.userId, f.actors.agent1.id));
      expect(session.ip).toBe("203.0.113.77");

      await authenticate(db, { email: "agent2@test.local", password: f.passwords.agent1 }, metaFor("6.6.6.6", noProxy));
      const [direct] = await db.select().from(signinLogs).where(eq(signinLogs.userId, f.actors.agent2.id));
      expect(direct.ip).toBeNull();
    });
  });
});
