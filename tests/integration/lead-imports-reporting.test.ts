import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { decideImportBatch, getImportBatch, listImportBatches, submitImport } from "@/modules/leads/imports";
import { listLeads } from "@/modules/leads/queries";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, leadImportBatches, leadImportRows, leads, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

async function failure(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

const HEADER = "name,phone,phone2,source,city,priority,note";

describe.skipIf(!hasTestDb)("Sprint P3: lead import batches, priority order, won / lost ranges (PostgreSQL)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [u] = await db.insert(users).values({ name: "Import Admin", email: "import.admin@test.local", role: "admin", passwordHash: "x" }).returning();
    admin = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  });

  const submit = (actor: Actor, lines: string[], projectId = f.projectId) => submitImport(db, actor, { projectId, fileName: "leads.csv", csv: [HEADER, ...lines].join("\n") });
  const leadCount = async () => (await db.select({ id: leads.id }).from(leads)).length;

  describe("submitting", () => {
    it("validates every row and sorts out duplicates before anything is created", async () => {
      await createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: "03001110001" }));
      const before = await leadCount();
      const r = await submit(admin, [
        "Ali Raza,03001110002,,Facebook,Islamabad,high,First",
        "Sara Khan,03001110003,03211110003,facebook,Murree,,",
        "Bad Phone,12,,Facebook,,,",
        "No Source,03001110004,,,,,",
        "Twice In File,03001110002,,Facebook,,,",
        "Existing,03009999999,03001110001,Facebook,,,",
        "Numeric City,03001110005,,Facebook,12345,,",
      ]);
      expect(r).toMatchObject({ totalRows: 7, valid: 2, duplicate: 2, invalid: 3 });
      expect(await leadCount()).toBe(before);
      const rows = await db.select().from(leadImportRows).where(eq(leadImportRows.batchId, r.batchId)).orderBy(leadImportRows.rowNo);
      expect(rows.map((x) => x.status)).toEqual(["valid", "valid", "invalid", "invalid", "duplicate", "duplicate", "invalid"]);
      expect(rows[4].errors).toEqual(["Same number as row 1 of this file"]);
      expect((rows[5].errors as string[])[0]).toMatch(/Already a lead in this project/);
      expect((rows[3].errors as string[]).join()).toMatch(/Source is required/);
      const [batch] = await db.select().from(leadImportBatches).where(eq(leadImportBatches.id, r.batchId));
      expect(batch).toMatchObject({ status: "pending", uploadedById: admin.id });
    });

    it("refuses a file with missing columns, no rows or broken quoting", async () => {
      expect((await failure(submitImport(db, admin, { projectId: f.projectId, csv: "name,source\nA,Facebook" }))).message).toMatch(/Missing column: phone/);
      expect((await failure(submitImport(db, admin, { projectId: f.projectId, csv: HEADER }))).message).toMatch(/no rows/);
      expect((await failure(submitImport(db, admin, { projectId: f.projectId, csv: `${HEADER}\n"unclosed,03001110009` }))).code).toBe("VALIDATION_FAILED");
      // Owner's decision (13 Nov 2026): only Admins and Super Admins import; agents and managers cannot.
      for (const who of [f.actors.agent1, f.actors.manager, f.actors.hr]) {
        expect((await failure(submit(who, ["A,03001110010,,Facebook,,,"]))).code, who.role).toBe("FORBIDDEN");
        expect((await failure(listImportBatches(db, who))).code, who.role).toBe("FORBIDDEN");
      }
    });

    it("an Admin sees only their own batches; a Super Admin sees all and can import too", async () => {
      const mine = await submit(admin, ["A One,03001110011,,Facebook,,,"]);
      const own = await submit(f.actors.superAdmin, ["B Two,03001110012,,Facebook,,,"]);
      expect((await listImportBatches(db, admin)).map((b) => b.id)).toEqual([mine.batchId]);
      expect(await listImportBatches(db, f.actors.superAdmin)).toHaveLength(2);
      expect((await failure(getImportBatch(db, admin, own.batchId))).code).toBe("NOT_FOUND");
      expect((await failure(getImportBatch(db, f.actors.agent1, mine.batchId))).code).toBe("NOT_FOUND");
      // A Super Admin's own batch still waits for approval.
      const [batch] = await db.select().from(leadImportBatches).where(eq(leadImportBatches.id, own.batchId));
      expect(batch.status).toBe("pending");
    });
  });

  describe("deciding", () => {
    it("only a Super Admin approves or rejects", async () => {
      const r = await submit(admin, ["A One,03001110021,,Facebook,,,"]);
      for (const who of [f.actors.agent1, f.actors.manager, admin]) {
        expect((await failure(decideImportBatch(db, who, r.batchId, { approve: true }))).code).toBe("FORBIDDEN");
      }
      expect(await leadCount()).toBe(0);
    });

    it("approval creates the valid rows through normal assignment, and records who and when", async () => {
      const r = await submit(admin, ["A One,03001110031,,Facebook,,high,Hi", "B Two,03001110032,,Facebook,,,", "Bad,1,,Facebook,,,"]);
      const result = await decideImportBatch(db, f.actors.superAdmin, r.batchId, { approve: true });
      expect(result).toEqual({ status: "approved", created: 2, skipped: 0 });
      const rows = await db.select().from(leadImportRows).where(eq(leadImportRows.batchId, r.batchId)).orderBy(leadImportRows.rowNo);
      expect(rows.map((x) => x.status)).toEqual(["created", "created", "invalid"]);
      const created = await db.select().from(leads).where(eq(leads.id, rows[0].leadId!));
      expect(created[0]).toMatchObject({ name: "A One", priority: "high" });
      const [batch] = await db.select().from(leadImportBatches).where(eq(leadImportBatches.id, r.batchId));
      expect(batch).toMatchObject({ status: "approved", decidedById: f.actors.superAdmin.id, createdLeads: 2 });
      expect(batch.decidedAt).toBeInstanceOf(Date);
      const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, r.batchId));
      expect(audits.map((a) => a.action).sort()).toEqual(["lead_import.approve", "lead_import.created", "lead_import.submit"]);
    });

    it("a row that became a duplicate while waiting is skipped, not doubled", async () => {
      const r = await submit(admin, ["Late Dup,03001110041,,Facebook,,,"]);
      await createLead(db, f.actors.agent2, leadInput(f, { phoneNumber: "03001110041" }));
      expect(await decideImportBatch(db, f.actors.superAdmin, r.batchId, { approve: true })).toEqual({ status: "approved", created: 0, skipped: 1 });
      expect(await db.select().from(leads).where(eq(leads.phoneE164, "+923001110041"))).toHaveLength(1);
    });

    it("rejection needs a reason and creates nothing", async () => {
      const r = await submit(admin, ["A One,03001110051,,Facebook,,,"]);
      expect((await failure(decideImportBatch(db, f.actors.superAdmin, r.batchId, { approve: false }))).fields?.note).toBeTruthy();
      expect(await decideImportBatch(db, f.actors.superAdmin, r.batchId, { approve: false, note: "Wrong project" })).toMatchObject({ status: "rejected", created: 0 });
      expect(await leadCount()).toBe(0);
    });

    it("a batch is decided once, even when two decisions arrive together", async () => {
      const r = await submit(admin, ["A One,03001110061,,Facebook,,,"]);
      const results = await Promise.allSettled([
        decideImportBatch(db, f.actors.superAdmin, r.batchId, { approve: true }),
        decideImportBatch(db, f.actors.superAdmin, r.batchId, { approve: false, note: "no" }),
      ]);
      expect(results.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect(((results.find((x) => x.status === "rejected") as PromiseRejectedResult).reason as AppError).code).toBe("CONFLICT");
      expect(await db.select().from(leads).where(eq(leads.phoneE164, "+923001110061"))).toHaveLength((await db.select().from(leadImportBatches).where(eq(leadImportBatches.id, r.batchId)))[0].status === "approved" ? 1 : 0);
    });

    it("manual leads never go through a batch", async () => {
      await createLead(db, f.actors.agent1, leadInput(f));
      expect(await db.select().from(leadImportBatches)).toEqual([]);
    });
  });

  describe("lead lists", () => {
    const names = async (query: Record<string, string> = {}) => (await listLeads(db, f.actors.superAdmin, f.projectId, query)).rows.map((r) => r.name);

    it("put High, Medium and Low priority leads above ordinary ones, newest first within each", async () => {
      for (const [name, priority] of [["Plain Old", "none"], ["Low One", "low"], ["High One", "high"], ["Plain New", "none"], ["Medium One", "medium"]] as const) {
        await createLead(db, f.actors.agent1, leadInput(f, { name, priority }));
      }
      expect(await names()).toEqual(["High One", "Medium One", "Low One", "Plain New", "Plain Old"]);
      expect((await names({ sort: "name", dir: "asc" }))[0]).toBe("High One");
    });

    it("report won and lost leads by this month, this quarter or custom dates of the decision", async () => {
      const make = async (name: string, stage: "booked" | "lost_lead", decided: Date) => {
        const r = await createLead(db, f.actors.agent1, leadInput(f, { name }));
        if (r.outcome !== "created") throw new Error("setup");
        await db.update(leads).set({ stage, stageChangedAt: decided }).where(eq(leads.id, r.leadId));
      };
      const now = new Date();
      await make("Won Now", "booked", now);
      await make("Won Long Ago", "booked", new Date("2020-01-15T06:00:00Z"));
      await make("Lost Now", "lost_lead", now);
      const won = async (q: Record<string, string>) => (await listLeads(db, f.actors.superAdmin, f.projectId, { view: "won", ...q })).rows.map((r) => r.name).sort();
      expect(await won({})).toEqual(["Won Long Ago", "Won Now"]);
      expect(await won({ dateField: "decided", period: "month" })).toEqual(["Won Now"]);
      expect(await won({ dateField: "decided", period: "quarter" })).toEqual(["Won Now"]);
      expect(await won({ dateField: "decided", from: "2020-01-01", to: "2020-01-31" })).toEqual(["Won Long Ago"]);
      expect((await listLeads(db, f.actors.superAdmin, f.projectId, { view: "lost", dateField: "decided", period: "month" })).rows.map((r) => r.name)).toEqual(["Lost Now"]);
    });
  });
});
