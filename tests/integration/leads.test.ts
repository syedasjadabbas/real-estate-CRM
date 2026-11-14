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
import { approvals, auditLogs, followUps, leads, sessions, signinLogs } from "@/server/db/schema";
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
      // client_linked: the lead created its person's client (13 Nov 2026).
      expect(detail.activities.map((a) => a.type).sort()).toEqual(["client_linked", "created", "note"]);
      expect((await db.select().from(auditLogs)).map((r) => r.action).sort()).toEqual(["client.create_from_lead", "lead.create"]);
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

    it("spreads unassigned leads across active team agents", async () => {
      const owners: (string | null)[] = [];
      for (let i = 0; i < 4; i += 1) {
        const r = await createLead(db, f.actors.superAdmin, leadInput(f));
        if (r.outcome === "created") {
          const [row] = await db.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, r.leadId));
          owners.push(row.ownerId);
        }
      }
      const expected = [f.actors.agent1.id, f.actors.agent2.id, f.actors.outsideAgent.id];
      // Workload counts, so the first three go to three different agents, then it starts again.
      expect(new Set(owners.slice(0, 3))).toEqual(new Set(expected));
      expect(expected).toContain(owners[3]);
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
    it("records optional remarks with a stage move, on the timeline and in the audit log", async () => {
      const r = await createLead(db, f.actors.agent1, leadInput(f));
      if (r.outcome !== "created") throw new Error("setup");
      await changeStage(db, f.actors.agent1, r.leadId, { stage: "contacted", remarks: "  Asked for the payment plan  " });
      await changeStage(db, f.actors.agent1, r.leadId, { stage: "qualified_lead", remarks: "   " });
      const moves = (await getLeadDetail(db, f.actors.agent1, r.leadId)).activities.filter((a) => a.type === "stage_change");
      const withRemarks = moves.find((a) => (a.data as { to?: string }).to === "contacted")!;
      const without = moves.find((a) => (a.data as { to?: string }).to === "qualified_lead")!;
      expect(withRemarks.data).toMatchObject({ remarks: "Asked for the payment plan" });
      expect(without.data).not.toHaveProperty("remarks");
      const [row] = await db.select().from(auditLogs).where(sql`${auditLogs.entityId} = ${r.leadId} and ${auditLogs.action} = 'lead.stage' and ${auditLogs.after}->>'stage' = 'contacted'`);
      expect(row.after).toMatchObject({ stage: "contacted", remarks: "Asked for the payment plan" });
      expect(await errorCode(changeStage(db, f.actors.agent1, r.leadId, { stage: "contacted", remarks: "x".repeat(1001) }))).toBe("VALIDATION_FAILED");
    });

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
      expect((await sharedPhoneGroups(db, f.actors.superAdmin, f.projectId)).groups).toHaveLength(0);
    });
  });
  describe("F-2: follow-ups of Lost leads leave To-dos and the follow-up filter", () => {
    // 11:00 in Pakistan, so "today" and "overdue" don't depend on when the suite runs.
    const NOW = new Date("2026-11-03T06:00:00Z");
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    const keys = async (bucket: "today" | "overdue" | "tomorrow" | "7d" | "doneToday") =>
      [...new Set((await leadTodos(db, f.actors.agent1, f.projectId, bucket, NOW)).items.map((i) => i.leadId))];
    const counts = async () => (await leadTodos(db, f.actors.agent1, f.projectId, "today", NOW)).counts;

    /** A lead with one follow-up due later today and one already overdue (due earlier today, so it is in Today too). */
    const leadWithFollowUps = async (name: string) => {
      const r = await createLead(db, f.actors.agent1, leadInput(f, { name }));
      if (r.outcome !== "created") throw new Error("setup");
      await scheduleFollowUp(db, f.actors.agent1, r.leadId, { dueAt: at(120), note: `${name} today` }, NOW);
      await scheduleFollowUp(db, f.actors.agent1, r.leadId, { dueAt: at(-60), note: `${name} overdue` }, at(-180));
      return r.leadId;
    };

    it("Lost leads drop out of Today and Overdue (lists and counts); active leads stay; history is untouched", async () => {
      const active = await leadWithFollowUps("Active Buyer");
      const lost = await leadWithFollowUps("Lost Buyer");
      expect((await keys("today")).sort()).toEqual([active, lost].sort());
      expect((await keys("overdue")).sort()).toEqual([active, lost].sort());
      expect(await counts()).toMatchObject({ today: 4, overdue: 2 });
      const before = await db.select().from(followUps).where(eq(followUps.leadId, lost)).orderBy(followUps.dueAt);

      await markLost(db, f.actors.manager, lost, { lostReasonId: f.lostReasonId });
      expect(await keys("today")).toEqual([active]);
      expect(await keys("overdue")).toEqual([active]);
      expect(await counts()).toMatchObject({ today: 2, overdue: 1 });

      // The follow-ups themselves are unchanged (still pending, same times and notes) and still on the lead page.
      const after = await db.select().from(followUps).where(eq(followUps.leadId, lost)).orderBy(followUps.dueAt);
      expect(after).toEqual(before);
      expect((await getLeadDetail(db, f.actors.agent1, lost)).followUps).toHaveLength(2);
    });

    it("an agent's lost request keeps the follow-ups active until a manager approves it", async () => {
      const lead = await leadWithFollowUps("Pending Lost");
      await markLost(db, f.actors.agent1, lead, { lostReasonId: f.lostReasonId });
      expect(await keys("overdue")).toEqual([lead]);
      const [request] = await pendingLostRequests(db, f.actors.manager, f.projectId);
      await decideLostRequest(db, f.actors.manager, request.id, { approve: true });
      expect(await keys("overdue")).toEqual([]);
    });

    it("moving a Lost lead back to an active stage brings its follow-ups back", async () => {
      const lead = await leadWithFollowUps("Comeback");
      await markLost(db, f.actors.manager, lead, { lostReasonId: f.lostReasonId });
      expect(await counts()).toMatchObject({ today: 0, overdue: 0 });
      await changeStage(db, f.actors.manager, lead, { stage: "contacted" });
      expect(await keys("today")).toEqual([lead]);
      expect(await keys("overdue")).toEqual([lead]);
      expect(await counts()).toMatchObject({ today: 2, overdue: 1 });
    });

    it("the leads list follow-up filter (overdue / due soon) leaves Lost leads out; the Lost view still lists them", async () => {
      const active = await leadWithFollowUps("Filter Active");
      const lost = await leadWithFollowUps("Filter Lost");
      await markLost(db, f.actors.manager, lost, { lostReasonId: f.lostReasonId });
      const overdue = (await listLeads(db, f.actors.agent1, f.projectId, { followUp: "overdue" }, NOW)).rows.map((r) => r.id);
      expect(overdue).toEqual([active]);
      const lostView = (await listLeads(db, f.actors.agent1, f.projectId, { view: "lost" }, NOW)).rows.map((r) => r.id);
      expect(lostView).toEqual([lost]);
    });
  });


  describe("F-3: duplicate phone check when a lead's phone is edited", () => {
    const errorOf = async (p: Promise<unknown>) => {
      try {
        await p;
        return null;
      } catch (e) {
        if (e instanceof AppError) return e;
        throw e;
      }
    };
    const make = async (actor = f.actors.agent1, phoneNumber?: string, extra: Record<string, unknown> = {}) => {
      const r = await createLead(db, actor, leadInput(f, { ...(phoneNumber ? { phoneNumber } : {}), ...extra }));
      if (r.outcome !== "created") throw new Error("setup");
      return r;
    };
    const row = async (id: string) => (await db.select().from(leads).where(eq(leads.id, id)))[0];
    const updates = async (id: string) => (await db.select().from(auditLogs).where(eq(auditLogs.entityId, id))).filter((a) => a.action === "lead.update").length;

    it("an edit that keeps the number (any formatting) is unchanged behaviour, even for a flagged duplicate", async () => {
      const a = await make(f.actors.agent1, "03001234567");
      const dup = await createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: "0300-1234567", onDuplicate: "duplicate" }));
      if (dup.outcome !== "created") throw new Error("setup");
      // Same number written differently: nothing to check, nothing changes.
      expect(await updateLead(db, f.actors.agent1, a.leadId, { phoneNumber: "+92 300 1234567" })).toEqual({ changed: [] });
      // The flagged duplicate keeps sharing the number while other fields are edited.
      expect(await updateLead(db, f.actors.agent1, dup.leadId, { name: "Renamed duplicate", phoneNumber: "300 1234567" })).toEqual({ changed: ["name"] });
    });

    it("a new, unused number is saved, normalized, audited and on the timeline", async () => {
      const a = await make();
      const before = await updates(a.leadId);
      expect(await updateLead(db, f.actors.manager, a.leadId, { phoneNumber: "0333-7654321" })).toEqual({ changed: ["phoneNumber", "phoneE164"] });
      expect(await row(a.leadId)).toMatchObject({ phoneNumber: "3337654321", phoneE164: "+923337654321" });
      expect(await updates(a.leadId)).toBe(before + 1);
      const detail = await getLeadDetail(db, f.actors.agent1, a.leadId);
      expect(detail.activities.find((x) => x.type === "update")?.data).toMatchObject({ fields: ["phoneNumber", "phoneE164"] });
    });

    it("a number another lead in the project already uses is refused, in any format; nothing is written", async () => {
      const original = await make(f.actors.agent1, "03001112222");
      const b = await make();
      const stored = await row(b.leadId);
      const auditsBefore = await updates(b.leadId);
      for (const phoneNumber of ["03001112222", "0300-111 2222", "+92 300 1112222", "0092 3001112222", "3001112222"]) {
        const e = await errorOf(updateLead(db, f.actors.manager, b.leadId, { phoneNumber, name: "Should not save" }));
        expect(e?.code, phoneNumber).toBe("CONFLICT");
        expect(e?.message).toBe("A lead with this phone number already exists in this project.");
        expect(e?.fields?.phoneNumber).toBe(`Already used by lead ${original.code}`);
        expect(e?.details).toMatchObject({ existingLeadId: original.leadId, existingCode: original.code });
      }
      // Country code given separately resolves to the same number.
      expect((await errorOf(updateLead(db, f.actors.manager, b.leadId, { phoneCountryCode: "+92", phoneNumber: "300 1112222" })))?.code).toBe("CONFLICT");
      expect(await row(b.leadId)).toEqual(stored);
      expect(await updates(b.leadId)).toBe(auditsBefore);
    });

    it("the same number in another project, or on a deleted lead, is allowed (same rule as create)", async () => {
      await make(f.actors.agent1, "03004445555");
      const elsewhere = await createLead(db, f.actors.superAdmin, leadInput(f, { projectId: f.otherProjectId }));
      if (elsewhere.outcome !== "created") throw new Error("setup");
      expect(await updateLead(db, f.actors.superAdmin, elsewhere.leadId, { phoneNumber: "03004445555" })).toEqual({ changed: ["phoneNumber", "phoneE164"] });

      const gone = await make(f.actors.agent1, "03006667777");
      await db.update(leads).set({ deletedAt: new Date() }).where(eq(leads.id, gone.leadId));
      const c = await make();
      expect(await updateLead(db, f.actors.manager, c.leadId, { phoneNumber: "03006667777" })).toEqual({ changed: ["phoneNumber", "phoneE164"] });
    });

    it("doesn't reveal a lead the editor can't see; permissions are unchanged", async () => {
      const hidden = await make(f.actors.outsideAgent, "03008889999");
      const mine = await make(f.actors.agent1);
      const e = await errorOf(updateLead(db, f.actors.manager, mine.leadId, { phoneNumber: "03008889999" }));
      expect(e?.code).toBe("CONFLICT");
      expect(e?.details).toEqual({});
      expect(e?.fields?.phoneNumber).toBe("Already used by another lead in this project");
      expect(JSON.stringify(e)).not.toContain(hidden.code);
      // Editing someone else's lead is still refused before any phone check; HR still can't edit.
      expect(await errorCode(updateLead(db, f.actors.agent2, mine.leadId, { phoneNumber: "03331230000" }))).toBe("NOT_FOUND");
      expect(await errorCode(updateLead(db, f.actors.hr, mine.leadId, { phoneNumber: "03331230000" }))).toBe("FORBIDDEN");
    });

    it("concurrent edits claiming the same new number: exactly one wins, the number is never shared", async () => {
      for (let i = 0; i < 6; i++) {
        const target = `0345${String(1_000_000 + i)}`;
        const [b, c] = [await make(), await make()];
        const results = await Promise.allSettled([
          updateLead(db, f.actors.manager, b.leadId, { phoneNumber: target }),
          updateLead(db, f.actors.manager, c.leadId, { phoneNumber: target }),
        ]);
        expect(results.filter((r) => r.status === "fulfilled"), `round ${i}`).toHaveLength(1);
        const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        expect((rejected.reason as AppError).code, `round ${i}`).toBe("CONFLICT");
        const holders = await db.select({ id: leads.id }).from(leads).where(eq(leads.phoneE164, `+92345${String(1_000_000 + i)}`));
        expect(holders, `round ${i}`).toHaveLength(1);
      }
    });

    it("an edit and a new lead racing for the same number: one wins; creation's duplicate check still works", async () => {
      for (let i = 0; i < 4; i++) {
        const target = `0346${String(1_000_000 + i)}`;
        const b = await make();
        const results = await Promise.allSettled([
          updateLead(db, f.actors.manager, b.leadId, { phoneNumber: target }),
          createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: target })),
        ]);
        expect(results.filter((r) => r.status === "fulfilled"), `round ${i}`).toHaveLength(1);
        const holders = await db.select({ id: leads.id }).from(leads).where(eq(leads.phoneE164, `+92346${String(1_000_000 + i)}`));
        expect(holders, `round ${i}`).toHaveLength(1);
      }
      // Creation itself is unchanged: reject by default, or save as a linked duplicate when chosen.
      const a = await make(f.actors.agent1, "03007778888");
      expect(await errorCode(createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: "0300 7778888" })))).toBe("CONFLICT");
      const dup = await createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: "+92 300 7778888", onDuplicate: "duplicate" }));
      if (dup.outcome !== "created") throw new Error("expected a created duplicate");
      expect((await row(dup.leadId)).duplicateOfId).toBe(a.leadId);
    });
  });

});
