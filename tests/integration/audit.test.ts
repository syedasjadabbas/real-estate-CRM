import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addClientNote, completeClientFollowUp, createClient, scheduleClientFollowUp } from "@/modules/clients/commands";
import { addNote, addReview, completeFollowUp, createLead, markLost, scheduleFollowUp, setFavorite } from "@/modules/leads/commands";
import { AUDIT_PAGE_SIZE, listAuditLogs, REDACTED } from "@/modules/audit/service";
import { loadActor } from "@/server/auth/session-store";
import { readProxyConfig, resolveClientIp } from "@/server/auth/client-ip";
import { auditLogs, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};
const IP = "203.0.113.7"; // documentation range (RFC 5737)
const soon = () => new Date(Date.now() + 3_600_000);

describe.skipIf(!hasTestDb)("Audit log (FR-008, F-4, PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;
  let accountant: Actor;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const make = async (name: string, email: string, role: "admin" | "accountant") => {
      const [u] = await db.insert(users).values({ name, email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    admin = await make("Zed Admin", "admin@test.local", "admin");
    accountant = await make("Acc", "acc@test.local", "accountant");
  });

  /** The actor as a web request sees it: the verified client IP attached (current-user.ts). */
  const withIp = (actor: Actor, ip: string | null = IP): Actor => ({ ...actor, ip });
  const rows = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action));
  const newLead = async (owner = f.actors.agent1) => {
    const r = await createLead(db, f.actors.superAdmin, leadInput(f, { ownerId: owner.id }));
    if (r.outcome !== "created") throw new Error("lead");
    return r.leadId;
  };
  const newClient = async () => (await createClient(db, f.actors.superAdmin, { name: "Audit Buyer", phoneCountryCode: "+92", phoneNumber: `0300 77${String(Date.now()).slice(-5)}`, ownerId: f.actors.agent1.id })).clientId;

  describe("the previously unaudited lead and client actions", () => {
    it("lead note: actor, IP, time and the latest comment before and after", async () => {
      const leadId = await newLead();
      const started = Date.now();
      await addNote(db, withIp(f.actors.agent1), leadId, { body: "Called, wants a 2-bed" });
      await addNote(db, withIp(f.actors.agent1), leadId, { body: "Site visit Friday" });
      const [first, second] = (await rows("lead.note")).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      expect(first).toMatchObject({ actorId: f.actors.agent1.id, entity: "lead", entityId: leadId, ip: IP, before: { latestComment: null }, after: { latestComment: "Called, wants a 2-bed" } });
      expect(second).toMatchObject({ before: { latestComment: "Called, wants a 2-bed" }, after: { latestComment: "Site visit Friday" } });
      expect(first.createdAt.getTime()).toBeGreaterThanOrEqual(started - 5_000);
    });

    it("lead follow-up scheduled and completed", async () => {
      const leadId = await newLead();
      const dueAt = soon();
      const { id } = await scheduleFollowUp(db, withIp(f.actors.agent1), leadId, { dueAt, note: "Send brochure" });
      expect(await rows("lead.follow_up")).toEqual([
        expect.objectContaining({ actorId: f.actors.agent1.id, entityId: leadId, ip: IP, before: null, after: { followUpId: id, dueAt: dueAt.toISOString(), assigneeId: f.actors.agent1.id, note: "Send brochure", status: "pending" } }),
      ]);
      await completeFollowUp(db, withIp(f.actors.manager), id);
      const [done] = await rows("lead.follow_up_done");
      expect(done).toMatchObject({ actorId: f.actors.manager.id, entityId: leadId, before: { followUpId: id, status: "pending" }, after: { followUpId: id, status: "done", dueAt: dueAt.toISOString() } });
      expect(typeof (done.after as { doneAt: string }).doneAt).toBe("string");
    });

    it("lead review", async () => {
      const leadId = await newLead();
      await addReview(db, withIp(f.actors.manager), leadId, { body: "Follow up faster" });
      expect(await rows("lead.review")).toEqual([expect.objectContaining({ actorId: f.actors.manager.id, entityId: leadId, ip: IP, before: null, after: expect.objectContaining({ body: "Follow up faster", reviewId: expect.any(String) }) })]);
    });

    it("favourite and unfavourite are audited only when the flag actually changes", async () => {
      const leadId = await newLead();
      await setFavorite(db, withIp(f.actors.agent1), leadId, true);
      await setFavorite(db, withIp(f.actors.agent1), leadId, true); // already a favourite: no-op
      await setFavorite(db, withIp(f.actors.agent1), leadId, false);
      await setFavorite(db, withIp(f.actors.agent1), leadId, false); // already removed: no-op
      expect(await rows("lead.favorite")).toEqual([expect.objectContaining({ actorId: f.actors.agent1.id, entityId: leadId, before: { favorite: false }, after: { favorite: true } })]);
      expect(await rows("lead.unfavorite")).toEqual([expect.objectContaining({ before: { favorite: true }, after: { favorite: false } })]);
    });

    it("client note, follow-up scheduled and completed", async () => {
      const clientId = await newClient();
      await addClientNote(db, withIp(f.actors.agent1), clientId, { body: "Prefers evening calls" });
      expect(await rows("client.note")).toEqual([expect.objectContaining({ actorId: f.actors.agent1.id, entity: "client", entityId: clientId, ip: IP, before: null, after: { body: "Prefers evening calls" } })]);
      const dueAt = soon();
      const { id } = await scheduleClientFollowUp(db, withIp(f.actors.agent1), clientId, { dueAt });
      expect(await rows("client.follow_up")).toEqual([
        expect.objectContaining({ entityId: clientId, after: { followUpId: id, dueAt: dueAt.toISOString(), assigneeId: f.actors.agent1.id, note: null, status: "pending" } }),
      ]);
      await completeClientFollowUp(db, withIp(f.actors.agent1), id);
      expect(await rows("client.follow_up_done")).toEqual([expect.objectContaining({ entityId: clientId, before: { followUpId: id, status: "pending" }, after: expect.objectContaining({ status: "done" }) })]);
    });
  });

  describe("failed actions write no audit row", () => {
    it("refused, invalid and repeated actions leave nothing behind", async () => {
      const leadId = await newLead(f.actors.agent1);
      const before = (await db.select().from(auditLogs)).length;
      const outsider = withIp(f.actors.outsideAgent);
      expect(await errorCode(addNote(db, outsider, leadId, { body: "x" }))).toBe("NOT_FOUND");
      expect(await errorCode(addNote(db, withIp(f.actors.agent1), leadId, { body: "" }))).toBe("VALIDATION_FAILED");
      expect(await errorCode(addNote(db, withIp(accountant), leadId, { body: "x" }))).toBe("FORBIDDEN");
      expect(await errorCode(addReview(db, withIp(f.actors.agent1), leadId, { body: "x" }))).toBe("FORBIDDEN");
      expect(await errorCode(setFavorite(db, outsider, leadId, true))).toBe("NOT_FOUND");
      expect(await errorCode(scheduleFollowUp(db, withIp(f.actors.agent1), leadId, { dueAt: new Date(Date.now() - 86_400_000) }))).toBe("VALIDATION_FAILED");
      const { id } = await scheduleFollowUp(db, withIp(f.actors.agent1), leadId, { dueAt: soon() });
      await completeFollowUp(db, withIp(f.actors.agent1), id);
      expect(await errorCode(completeFollowUp(db, withIp(f.actors.agent1), id))).toBe("BUSINESS_RULE");
      await markLost(db, f.actors.manager, leadId, { lostReasonId: f.lostReasonId });
      expect(await errorCode(scheduleFollowUp(db, withIp(f.actors.agent1), leadId, { dueAt: soon() }))).toBe("BUSINESS_RULE"); // closed lead
      const clientId = await newClient();
      expect(await errorCode(addClientNote(db, outsider, clientId, { body: "x" }))).toBe("NOT_FOUND");
      expect(await errorCode(completeClientFollowUp(db, withIp(f.actors.agent1), "00000000-0000-0000-0000-000000000000"))).toBe("NOT_FOUND");

      const actions = (await db.select({ a: auditLogs.action }).from(auditLogs)).map((r) => r.a).slice(before);
      // Only the successful schedule, completion, mark-lost and client creation were audited.
      expect(actions.sort()).toEqual(["client.create", "lead.follow_up", "lead.follow_up_done", "lead.lost"].sort());
    });
  });

  describe("IP handling", () => {
    it("stores the verified IP; without one (jobs, untrusted requests) it stays empty, never invented", async () => {
      const leadId = await newLead();
      await addNote(db, withIp(f.actors.agent1, "198.51.100.20"), leadId, { body: "with ip" });
      await addNote(db, withIp(f.actors.agent1, null), leadId, { body: "untrusted request" });
      await addNote(db, f.actors.agent1, leadId, { body: "no request at all" });
      const ips = (await rows("lead.note")).map((r) => [(r.after as { latestComment: string }).latestComment, r.ip]).sort();
      expect(ips).toEqual([
        ["no request at all", null],
        ["untrusted request", null],
        ["with ip", "198.51.100.20"],
      ]);
    });

    it("the IP comes only from the trusted-proxy resolver: a browser-supplied header gives none", () => {
      const browserSent = { get: (h: string) => (h === "x-forwarded-for" ? "6.6.6.6" : null) };
      expect(resolveClientIp(browserSent, readProxyConfig({ NODE_ENV: "production" })).ip).toBeNull();
      expect(resolveClientIp(browserSent, readProxyConfig({ NODE_ENV: "development" })).ip).toBeNull();
      const viaProxy = { get: (h: string) => (h === "x-forwarded-for" ? "6.6.6.6, 198.51.100.9" : null) };
      expect(resolveClientIp(viaProxy, readProxyConfig({ NODE_ENV: "production", TRUST_PROXY: "true" })).ip).toBe("198.51.100.9");
    });

    it("every audit write in the code passes the actor's IP", () => {
      const files: string[] = [];
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.tsx?$/.test(p)) files.push(p);
        }
      };
      walk(path.resolve("src"));
      const missing: string[] = [];
      for (const file of files) {
        const src = fs.readFileSync(file, "utf8");
        for (const m of src.matchAll(/insert\(auditLogs\)\.values\(\{[^}]*\}/g)) if (!/\bip:/.test(m[0])) missing.push(`${path.relative(process.cwd(), file)}: ${m[0].slice(0, 80)}`);
      }
      expect(missing).toEqual([]);
    });
  });

  describe("the audit-log viewer", () => {
    it("is for Super Admins and Admins only", async () => {
      await newLead();
      expect((await listAuditLogs(db, f.actors.superAdmin)).total).toBeGreaterThan(0);
      expect((await listAuditLogs(db, admin)).total).toBeGreaterThan(0);
      for (const who of [f.actors.manager, f.actors.agent1, f.actors.hr, accountant]) expect(await errorCode(listAuditLogs(db, who))).toBe("FORBIDDEN");
    });

    it("filters by user, record type, action, Pakistan date and search, and sorts", async () => {
      const leadId = await newLead(f.actors.agent2);
      await addNote(db, withIp(f.actors.agent2), leadId, { body: "Unique-needle-42" });
      await setFavorite(db, withIp(f.actors.manager), leadId, true);

      const byUser = await listAuditLogs(db, admin, { actor: f.actors.agent2.id });
      expect(byUser.rows.map((r) => r.action)).toEqual(["lead.note"]);
      expect(byUser.rows[0]).toMatchObject({ actorName: f.actors.agent2.name, actorRole: "agent", ip: IP, entityId: leadId });
      expect((await listAuditLogs(db, admin, { entity: "lead", action: "lead.favorite" })).rows.map((r) => r.actorId)).toEqual([f.actors.manager.id]);
      expect((await listAuditLogs(db, admin, { q: "needle-42" })).total).toBe(1);
      expect((await listAuditLogs(db, admin, { q: IP })).total).toBe(2);
      expect((await listAuditLogs(db, admin, { q: f.actors.agent2.name })).total).toBe(1);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
      const all = (await listAuditLogs(db, admin)).total;
      expect((await listAuditLogs(db, admin, { from: today, to: today })).total).toBe(all);
      expect((await listAuditLogs(db, admin, { to: "2000-01-01" })).total).toBe(0);
      expect((await listAuditLogs(db, admin, { from: "2999-01-01" })).total).toBe(0);
      // Filter values on offer come from the log itself.
      const { options } = await listAuditLogs(db, admin, { entity: "lead" });
      expect(options.entities).toContain("lead");
      expect(options.actions.every((a) => a.startsWith("lead."))).toBe(true);
      expect(options.actors.map((a) => a.id)).toEqual(expect.arrayContaining([f.actors.agent2.id, f.actors.manager.id]));

      const newestFirst = (await listAuditLogs(db, admin)).rows.map((r) => r.createdAt.getTime());
      expect(newestFirst).toEqual([...newestFirst].sort((a, b) => b - a));
      const oldestFirst = (await listAuditLogs(db, admin, { sort: "time", dir: "asc" })).rows.map((r) => r.createdAt.getTime());
      expect(oldestFirst).toEqual([...oldestFirst].sort((a, b) => a - b));
      const byAction = (await listAuditLogs(db, admin, { sort: "action", dir: "asc" })).rows.map((r) => r.action);
      expect(byAction).toEqual([...byAction].sort());
      // Junk parameters fall back to defaults instead of failing.
      expect((await listAuditLogs(db, admin, { sort: "drop table", dir: "sideways", page: "-4", actor: "nope", from: "yesterday" })).query).toMatchObject({ sort: "time", dir: "desc", page: 1 });
    });

    it("pages 50 at a time", async () => {
      await db.insert(auditLogs).values(Array.from({ length: 60 }, (_, i) => ({ actorId: admin.id, action: "test.bulk", entity: "test", entityId: String(i) })));
      const first = await listAuditLogs(db, admin, { action: "test.bulk" });
      expect(first).toMatchObject({ total: 60, page: 1, pageCount: 2 });
      expect(first.rows).toHaveLength(AUDIT_PAGE_SIZE);
      const second = await listAuditLogs(db, admin, { action: "test.bulk", page: "2" });
      expect(second.rows).toHaveLength(10);
      expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(60);
      expect((await listAuditLogs(db, admin, { action: "test.bulk", page: "99" })).page).toBe(2);
    });

    it("never shows secret-looking values, even if a row held one; business fields stay", async () => {
      await db.insert(auditLogs).values({ actorId: admin.id, action: "test.secret", entity: "test", before: { password: "hunter2", nested: { tokenHash: "abc" } }, after: { apiKey: "k", tokenAmount: 500000 } });
      const [row] = (await listAuditLogs(db, admin, { action: "test.secret" })).rows;
      expect(row.before).toEqual({ password: REDACTED, nested: { tokenHash: REDACTED } });
      expect(row.after).toEqual({ apiKey: REDACTED, tokenAmount: 500000 });
    });

    it("no command or route can edit or delete audit rows", () => {
      const src = (p: string) => fs.readFileSync(path.resolve(p), "utf8");
      const route = src("src/app/api/v1/audit-logs/route.ts");
      expect(route).toMatch(/export const GET/);
      expect(route).not.toMatch(/export const (POST|PUT|PATCH|DELETE)/);
      const files: string[] = [];
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.tsx?$/.test(p)) files.push(p);
        }
      };
      walk(path.resolve("src"));
      expect(files.filter((file) => /(update|delete)\(auditLogs\)/.test(fs.readFileSync(file, "utf8")))).toEqual([]);
    });
  });

  it("existing audit rows keep working alongside the new ones (no IP before this change)", async () => {
    await db.insert(auditLogs).values({ actorId: f.actors.superAdmin.id, action: "lead.stage", entity: "lead", entityId: "legacy", before: { stage: "new" }, after: { stage: "contacted" } });
    const [legacy] = (await listAuditLogs(db, admin, { q: "legacy" })).rows;
    expect(legacy).toMatchObject({ action: "lead.stage", ip: null, before: { stage: "new" } });
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, "legacy"), eq(auditLogs.action, "lead.stage")))).toHaveLength(1);
  });
});
