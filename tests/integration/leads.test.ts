import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addNote,
  addReview,
  assignLead,
  changeStage,
  completeFollowUp,
  createLead,
  decideLostRequest,
  markLost,
  scheduleFollowUp,
  setFavorite,
  updateLead,
} from "@/modules/leads/commands";
import { getLeadDetail, leadTodos, listLeads, pendingLostRequests, pipelineBoard, sharedPhoneGroups } from "@/modules/leads/queries";
import { authenticate } from "@/server/auth/login";
import { findActorByToken, hashToken, revokeSession } from "@/server/auth/session-store";
import { approvals, auditLogs, leads, sessions, signinLogs } from "@/server/db/schema";
import type { Database } from "@/server/db";
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

describe.skipIf(!hasTestDb)("Leads module (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
  });

  describe("authentication", () => {
    it("logs in with the right password, resolves the session and logs sign-in/out", async () => {
      const { token } = await authenticate(db, { email: "AGENT1@test.local", password: f.passwords.agent1 }, { ip: "10.0.0.1" });
      const actor = await findActorByToken(db, token);
      expect(actor?.email).toBe("agent1@test.local");
      await revokeSession(db, token);
      expect(await findActorByToken(db, token)).toBeNull();
      const logs = await db.select().from(signinLogs);
      expect(logs.map((l) => l.event).sort()).toEqual(["sign_in", "sign_out"]);
    });

    it("expires sessions after 12 h idle or past the absolute limit, and slides the idle window", async () => {
      const idle = await authenticate(db, { email: "agent1@test.local", password: f.passwords.agent1 }, { ip: "10.0.0.3" });
      await db
        .update(sessions)
        .set({ lastSeenAt: sql`now() - interval '6 hours'` })
        .where(eq(sessions.tokenHash, hashToken(idle.token)));
      expect((await findActorByToken(db, idle.token))?.email).toBe("agent1@test.local");
      const [touched] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(idle.token)));
      expect(Date.now() - touched.lastSeenAt.getTime()).toBeLessThan(60_000);

      await db
        .update(sessions)
        .set({ lastSeenAt: sql`now() - interval '13 hours'` })
        .where(eq(sessions.tokenHash, hashToken(idle.token)));
      expect(await findActorByToken(db, idle.token)).toBeNull();

      const old = await authenticate(db, { email: "agent1@test.local", password: f.passwords.agent1 }, { ip: "10.0.0.3" });
      await db
        .update(sessions)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(sessions.tokenHash, hashToken(old.token)));
      expect(await findActorByToken(db, old.token)).toBeNull();
    });

    it("rejects a wrong password with a generic message", async () => {
      expect(await errorCode(authenticate(db, { email: "agent1@test.local", password: "wrong" }, { ip: "10.0.0.2" }))).toBe(
        "UNAUTHENTICATED",
      );
      expect(await errorCode(authenticate(db, { email: "nobody@test.local", password: "wrong" }, { ip: "10.0.0.2" }))).toBe(
        "UNAUTHENTICATED",
      );
    });
  });

  describe("create and retrieve", () => {
    it("persists a lead with a unique code, normalised phone and history", async () => {
      const result = await createLead(db, f.actors.agent1, leadInput(f, { name: "Ali Raza", note: "Interested in 1 bed" }));
      expect(result.outcome).toBe("created");
      if (result.outcome !== "created") return;
      expect(result.code).toMatch(/^[A-Z]{8}$/);

      const detail = await getLeadDetail(db, f.actors.agent1, result.leadId);
      expect(detail.lead.name).toBe("Ali Raza");
      expect(detail.lead.ownerId).toBe(f.actors.agent1.id);
      expect(detail.lead.phoneE164).toMatch(/^\+92300\d+$/);
      expect(detail.lead.latestComment).toBe("Interested in 1 bed");
      expect(detail.lead.firstTouchAt).not.toBeNull();
      expect(detail.activities.map((a) => a.type).sort()).toEqual(["created", "note"]);
      expect(await db.select().from(auditLogs)).toHaveLength(1);
    });

    it("returns field errors for invalid input", async () => {
      try {
        await createLead(db, f.actors.agent1, { projectId: f.projectId, name: "", phoneCountryCode: "+92", phoneNumber: "1" });
        expect.unreachable();
      } catch (e) {
        expect((e as AppError).code).toBe("VALIDATION_FAILED");
        expect((e as AppError).fields).toHaveProperty("name");
      }
    });

    it("rotates unassigned leads across active team agents", async () => {
      const owners: (string | null)[] = [];
      for (let i = 0; i < 4; i += 1) {
        const r = await createLead(db, f.actors.superAdmin, leadInput(f));
        if (r.outcome === "created") {
          const [row] = await db.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, r.leadId));
          owners.push(row.ownerId);
        }
      }
      const expected = [f.actors.agent1.id, f.actors.agent2.id, f.actors.outsideAgent.id];
      // Alphabetical by name: Agent A, Agent B, Agent Outside, then wrap.
      expect(owners).toEqual([...expected, expected[0]]);
    });
  });

  describe("duplicates and re-inquiries", () => {
    it("warns, then records a duplicate or a regenerated lead on request", async () => {
      const input = leadInput(f);
      const first = await createLead(db, f.actors.agent1, input);
      expect(await errorCode(createLead(db, f.actors.agent1, input))).toBe("CONFLICT");

      const dup = await createLead(db, f.actors.agent1, { ...input, onDuplicate: "duplicate" });
      expect(dup.outcome).toBe("created");
      const dupList = await listLeads(db, f.actors.agent1, f.projectId, { view: "duplicates" });
      expect(dupList.total).toBe(1);
      expect(dupList.rows[0].originalCode).toBe(first.code);

      const regen = await createLead(db, f.actors.agent1, { ...input, onDuplicate: "regenerate" });
      expect(regen).toMatchObject({ outcome: "regenerated", leadId: first.leadId });
      const regenList = await listLeads(db, f.actors.agent1, f.projectId, { view: "regenerated" });
      expect(regenList.rows.map((r) => r.id)).toEqual([first.leadId]);
    });

    it("does not reveal another agent's lead in the duplicate warning", async () => {
      const input = leadInput(f);
      await createLead(db, f.actors.agent1, input);
      try {
        await createLead(db, f.actors.agent2, input);
        expect.unreachable();
      } catch (e) {
        expect((e as AppError).code).toBe("CONFLICT");
        expect((e as AppError).details).toEqual({});
      }
    });
  });

  describe("authorization", () => {
    it("scopes visibility: own (agent), team (manager), all (admin), none (HR)", async () => {
      const a1 = await createLead(db, f.actors.agent1, leadInput(f));
      const out = await createLead(db, f.actors.outsideAgent, leadInput(f));
      if (a1.outcome !== "created" || out.outcome !== "created") throw new Error("setup");

      expect(await errorCode(getLeadDetail(db, f.actors.agent2, a1.leadId))).toBe("NOT_FOUND");
      expect(await errorCode(getLeadDetail(db, f.actors.manager, a1.leadId))).toBe("ok");
      expect(await errorCode(getLeadDetail(db, f.actors.manager, out.leadId))).toBe("NOT_FOUND");
      expect(await errorCode(getLeadDetail(db, f.actors.superAdmin, out.leadId))).toBe("ok");
      expect(await errorCode(getLeadDetail(db, f.actors.hr, a1.leadId))).toBe("FORBIDDEN");
      expect(await errorCode(createLead(db, f.actors.hr, leadInput(f)))).toBe("FORBIDDEN");
      expect(await errorCode(pendingLostRequests(db, f.actors.hr, f.projectId))).toBe("FORBIDDEN");

      expect((await listLeads(db, f.actors.agent2, f.projectId, {})).total).toBe(0);
      expect((await listLeads(db, f.actors.manager, f.projectId, {})).total).toBe(1);
      expect((await listLeads(db, f.actors.superAdmin, f.projectId, {})).total).toBe(2);
    });

    it("blocks agents from editing, reassigning or reviewing others' leads", async () => {
      const a1 = await createLead(db, f.actors.agent1, leadInput(f));
      if (a1.outcome !== "created") throw new Error("setup");
      expect(await errorCode(updateLead(db, f.actors.agent2, a1.leadId, { name: "Hijacked" }))).toBe("NOT_FOUND");
      expect(await errorCode(changeStage(db, f.actors.agent2, a1.leadId, { stage: "contacted" }))).toBe("NOT_FOUND");
      expect(await errorCode(assignLead(db, f.actors.agent1, a1.leadId, { ownerId: f.actors.agent2.id }))).toBe("FORBIDDEN");
      expect(await errorCode(addReview(db, f.actors.agent1, a1.leadId, { body: "x" }))).toBe("FORBIDDEN");
    });

    it("lets a manager reassign within the team but not outside it", async () => {
      const a1 = await createLead(db, f.actors.agent1, leadInput(f));
      if (a1.outcome !== "created") throw new Error("setup");
      expect(await errorCode(assignLead(db, f.actors.manager, a1.leadId, { ownerId: f.actors.outsideAgent.id }))).toBe("FORBIDDEN");
      expect(await errorCode(assignLead(db, f.actors.manager, a1.leadId, { ownerId: f.actors.agent2.id }))).toBe("ok");
      expect(await errorCode(getLeadDetail(db, f.actors.agent2, a1.leadId))).toBe("ok");
      expect(await errorCode(getLeadDetail(db, f.actors.agent1, a1.leadId))).toBe("NOT_FOUND");
    });
  });

  describe("editing, stages and history", () => {
    it("persists edits and stage changes with history", async () => {
      const r = await createLead(db, f.actors.agent1, leadInput(f));
      if (r.outcome !== "created") throw new Error("setup");
      await updateLead(db, f.actors.agent1, r.leadId, { name: "Renamed", priority: "high" });
      await changeStage(db, f.actors.agent1, r.leadId, { stage: "qualified_lead" });
      expect(await errorCode(changeStage(db, f.actors.agent1, r.leadId, { stage: "booked" }))).toBe("BUSINESS_RULE");
      expect(await errorCode(changeStage(db, f.actors.agent1, r.leadId, { stage: "lost_lead" }))).toBe("BUSINESS_RULE");

      const detail = await getLeadDetail(db, f.actors.agent1, r.leadId);
      expect(detail.lead).toMatchObject({ name: "Renamed", priority: "high", stage: "qualified_lead" });

      // A partial edit leaves omitted fields alone (priority used to fall back to "none").
      await updateLead(db, f.actors.agent1, r.leadId, { desiredSize: "5 marla" });
      expect((await getLeadDetail(db, f.actors.agent1, r.leadId)).lead).toMatchObject({ priority: "high", desiredSize: "5 marla" });
      const stageChange = detail.activities.find((a) => a.type === "stage_change");
      expect(stageChange?.data).toMatchObject({ from: "new_lead", to: "qualified_lead" });
      expect(detail.lead.firstTouchAt).not.toBeNull();
    });

    it("schedules and completes follow-ups and keeps next follow-up in sync", async () => {
      const r = await createLead(db, f.actors.agent1, leadInput(f));
      if (r.outcome !== "created") throw new Error("setup");
      const now = new Date();
      const soon = new Date(now.getTime() + 2 * 3_600_000);
      const later = new Date(now.getTime() + 48 * 3_600_000);
      const first = await scheduleFollowUp(db, f.actors.agent1, r.leadId, { dueAt: later.toISOString() });
      const second = await scheduleFollowUp(db, f.actors.agent1, r.leadId, { dueAt: soon.toISOString(), note: "Call back" });
      let [row] = await db.select().from(leads).where(eq(leads.id, r.leadId));
      expect(row.nextFollowUpAt?.getTime()).toBe(soon.getTime());

      await completeFollowUp(db, f.actors.agent1, second.id);
      [row] = await db.select().from(leads).where(eq(leads.id, r.leadId));
      expect(row.nextFollowUpAt?.getTime()).toBe(later.getTime());
      expect(await errorCode(completeFollowUp(db, f.actors.agent1, second.id))).toBe("BUSINESS_RULE");
      expect(await errorCode(completeFollowUp(db, f.actors.agent2, first.id))).toBe("NOT_FOUND");
      expect(await errorCode(scheduleFollowUp(db, f.actors.agent1, r.leadId, { dueAt: "2000-01-01T00:00:00Z" }))).toBe(
        "VALIDATION_FAILED",
      );

      const todos = await leadTodos(db, f.actors.agent1, f.projectId, "doneToday");
      expect(todos.counts.doneToday).toBe(1);
    });

    it("notes update the latest comment", async () => {
      const r = await createLead(db, f.actors.agent1, leadInput(f));
      if (r.outcome !== "created") throw new Error("setup");
      await addNote(db, f.actors.agent1, r.leadId, { body: "Sent brochure" });
      const detail = await getLeadDetail(db, f.actors.agent1, r.leadId);
      expect(detail.lead.latestComment).toBe("Sent brochure");
    });
  });

  describe("lost flow", () => {
    it("agent request needs manager approval; manager can mark lost directly", async () => {
      const r = await createLead(db, f.actors.agent1, leadInput(f));
      if (r.outcome !== "created") throw new Error("setup");

      expect(await markLost(db, f.actors.agent1, r.leadId, { lostReasonId: f.lostReasonId })).toEqual({ status: "pending_approval" });
      expect(await errorCode(markLost(db, f.actors.agent1, r.leadId, { lostReasonId: f.lostReasonId }))).toBe("CONFLICT");
      let [row] = await db.select().from(leads).where(eq(leads.id, r.leadId));
      expect(row.stage).toBe("new_lead");

      const pending = await pendingLostRequests(db, f.actors.manager, f.projectId);
      expect(pending).toHaveLength(1);
      expect(await errorCode(decideLostRequest(db, f.actors.agent1, pending[0].id, { approve: true }))).toBe("FORBIDDEN");
      await decideLostRequest(db, f.actors.manager, pending[0].id, { approve: true, comment: "OK" });
      [row] = await db.select().from(leads).where(eq(leads.id, r.leadId));
      expect(row.stage).toBe("lost_lead");
      expect(row.lostReasonId).toBe(f.lostReasonId);
      const [approval] = await db.select().from(approvals);
      expect(approval.status).toBe("approved");

      const r2 = await createLead(db, f.actors.agent2, leadInput(f));
      if (r2.outcome !== "created") throw new Error("setup");
      expect(await markLost(db, f.actors.manager, r2.leadId, { lostReasonId: f.lostReasonId })).toEqual({ status: "lost" });
    });
  });

  describe("lists, search, filters and board", () => {
    it("searches by name, phone and code and filters by stage/priority", async () => {
      const a = await createLead(db, f.actors.agent1, leadInput(f, { name: "Sana Malik", priority: "high", phoneNumber: "03215550001" }));
      const b = await createLead(db, f.actors.agent1, leadInput(f, { name: "Usman Tariq", email: "usman@example.com" }));
      if (a.outcome !== "created" || b.outcome !== "created") throw new Error("setup");
      await changeStage(db, f.actors.agent1, b.leadId, { stage: "contacted" });

      const byName = await listLeads(db, f.actors.agent1, f.projectId, { q: "sana" });
      expect(byName.rows.map((r) => r.id)).toEqual([a.leadId]);
      const byPhone = await listLeads(db, f.actors.agent1, f.projectId, { q: "0321 5550001" });
      expect(byPhone.rows.map((r) => r.id)).toEqual([a.leadId]);
      const byCode = await listLeads(db, f.actors.agent1, f.projectId, { q: b.code.toLowerCase() });
      expect(byCode.rows.map((r) => r.id)).toEqual([b.leadId]);
      const byEmail = await listLeads(db, f.actors.agent1, f.projectId, { q: "usman@" });
      expect(byEmail.total).toBe(1);

      expect((await listLeads(db, f.actors.agent1, f.projectId, { stage: "contacted" })).total).toBe(1);
      expect((await listLeads(db, f.actors.agent1, f.projectId, { priority: "high" })).rows[0].id).toBe(a.leadId);
      expect((await listLeads(db, f.actors.agent1, f.otherProjectId, {})).total).toBe(0);

      const sorted = await listLeads(db, f.actors.agent1, f.projectId, { sort: "name", dir: "asc" });
      expect(sorted.rows.map((r) => r.name)).toEqual(["Sana Malik", "Usman Tariq"]);

      const board = await pipelineBoard(db, f.actors.agent1, f.projectId, {});
      expect(board.total).toBe(2);
      expect(board.columns.find((c) => c.stage === "contacted")?.total).toBe(1);
    });

    it("favorites are personal", async () => {
      const r = await createLead(db, f.actors.superAdmin, leadInput(f, { ownerId: f.actors.agent1.id }));
      if (r.outcome !== "created") throw new Error("setup");
      await setFavorite(db, f.actors.agent1, r.leadId, true);
      expect((await listLeads(db, f.actors.agent1, f.projectId, { view: "favorites" })).total).toBe(1);
      expect((await listLeads(db, f.actors.superAdmin, f.projectId, { view: "favorites" })).total).toBe(0);
      expect(await errorCode(setFavorite(db, f.actors.agent2, r.leadId, true))).toBe("NOT_FOUND");
    });

    it("groups visible leads that share a phone", async () => {
      const input = leadInput(f);
      await createLead(db, f.actors.superAdmin, { ...input, ownerId: f.actors.agent1.id });
      await createLead(db, f.actors.superAdmin, leadInput(f, { phoneNumber: input.phoneNumber, projectId: f.otherProjectId }));
      expect(await sharedPhoneGroups(db, f.actors.superAdmin, f.projectId)).toHaveLength(0);
    });
  });
});
