import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@/modules/clients/commands";
import { readAssignmentSettings, updateAssignmentSettings } from "@/modules/leads/assignment";
import { claimLead, listUnassigned } from "@/modules/leads/claims";
import { assignLead, createLead, updateLead } from "@/modules/leads/commands";
import { getLeadDetail } from "@/modules/leads/queries";
import { loadActor } from "@/server/auth/session-store";
import { appSettings, clientActivities, leadAssignments, leadPhones, leads, rosterEntries, teams, users } from "@/server/db/schema";
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

let seq = 4_100_000;
const phone = () => `0300${(seq += 1)}`;
const today = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);

describe.skipIf(!hasTestDb)("Sprint P1–P2: phones, customers, ownership, claims, scored assignment (PostgreSQL)", () => {
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
    const [u] = await db.insert(users).values({ name: "Owner Admin", email: "owner.admin@test.local", role: "admin", passwordHash: "x" }).returning();
    admin = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  });

  const lead = async (actor: Actor, overrides: Record<string, unknown> = {}) => {
    const r = await createLead(db, actor, leadInput(f, { phoneNumber: phone(), ...overrides }));
    if (r.outcome !== "created") throw new Error("setup");
    return r;
  };
  const row = async (id: string) => (await db.select().from(leads).where(eq(leads.id, id)))[0];
  const history = (id: string) => db.select().from(leadAssignments).where(eq(leadAssignments.leadId, id));

  describe("five phone numbers", () => {
    it("treats 0300…, +92 300… and 92 300… as the same customer, as a primary or an extra number", async () => {
      const first = await lead(f.actors.agent1, { phoneNumber: "0300 7654321" });
      expect((await row(first.leadId)).phoneE164).toBe("+923007654321");
      for (const typed of ["92 300 7654321", "+92 300 7654321", "92-0300-7654321"]) {
        expect((await failure(createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: typed })))).code, typed).toBe("CONFLICT");
        expect((await failure(createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: phone(), phones: [{ countryCode: "+92", number: typed }] })))).code, `extra ${typed}`).toBe("CONFLICT");
      }
      // A lead stored with a bare 92 is found from the national form, too.
      const second = await lead(f.actors.agent1, { phoneNumber: "92 321 5550001" });
      expect((await row(second.leadId)).phoneE164).toBe("+923215550001");
      expect((await failure(createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: "0321-5550001" })))).code).toBe("CONFLICT");
    });

    it("stores up to four extra numbers, normalised, with only the first required", async () => {
      const r = await lead(f.actors.agent1, { phones: [{ countryCode: "+92", number: "0321 1112223" }, { countryCode: "+44", number: "7700 900123" }, { countryCode: "+92", number: "" }] });
      const stored = await db.select().from(leadPhones).where(eq(leadPhones.leadId, r.leadId));
      expect(stored.map((p) => [p.position, p.e164]).sort()).toEqual([[2, "+923211112223"], [3, "+447700900123"]]);
      expect((await getLeadDetail(db, f.actors.agent1, r.leadId)).lead.phones?.length).toBe(2);
      const plain = await lead(f.actors.agent1);
      expect(await db.select().from(leadPhones).where(eq(leadPhones.leadId, plain.leadId))).toEqual([]);
    });

    it("refuses an invalid extra number, a repeat, and more than four", async () => {
      const bad = await failure(createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: phone(), phones: [{ countryCode: "+92", number: "12" }] })));
      expect(bad.fields?.["phones.0"]).toBe("Enter a valid phone number");
      const p = phone();
      const repeat = await failure(createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: p, phones: [{ countryCode: "+92", number: p }] })));
      expect(repeat.fields?.["phones.0"]).toBe("This number is already entered");
      const many = Array.from({ length: 5 }, () => ({ countryCode: "+92", number: phone() }));
      expect((await failure(createLead(db, f.actors.agent1, leadInput(f, { phoneNumber: phone(), phones: many })))).code).toBe("VALIDATION_FAILED");
    });

    it("finds a duplicate through any number, primary or extra", async () => {
      const shared = phone();
      await lead(f.actors.agent1, { phones: [{ countryCode: "+92", number: shared }] });
      const dup = await failure(createLead(db, f.actors.agent2, leadInput(f, { phoneNumber: shared })));
      expect(dup.code).toBe("CONFLICT");
      const viaExtra = await failure(createLead(db, f.actors.agent2, leadInput(f, { phoneNumber: phone(), phones: [{ countryCode: "+92", number: shared }] })));
      expect(viaExtra.code).toBe("CONFLICT");
    });

    it("edits extra numbers, refusing one that another lead in the project holds", async () => {
      const taken = phone();
      await lead(f.actors.agent1, { phoneNumber: taken });
      const mine = await lead(f.actors.agent1);
      await updateLead(db, f.actors.agent1, mine.leadId, { phones: [{ countryCode: "+92", number: phone() }] });
      expect(await db.select().from(leadPhones).where(eq(leadPhones.leadId, mine.leadId))).toHaveLength(1);
      expect((await failure(updateLead(db, f.actors.agent1, mine.leadId, { phones: [{ countryCode: "+92", number: taken }] }))).code).toBe("CONFLICT");
      await updateLead(db, f.actors.agent1, mine.leadId, { phones: [] });
      expect(await db.select().from(leadPhones).where(eq(leadPhones.leadId, mine.leadId))).toEqual([]);
    });
  });

  describe("returning customers", () => {
    it("a returning customer in another project goes to their original agent, whoever creates it", async () => {
      const shared = phone();
      await lead(f.actors.agent1, { phoneNumber: shared });
      const again = await lead(f.actors.agent2, { projectId: f.otherProjectId, phoneNumber: phone(), phones: [{ countryCode: "+92", number: shared }] });
      expect((await row(again.leadId)).ownerId).toBe(f.actors.agent1.id);
      expect(again.visible).toBe(false);
      const [h] = await history(again.leadId);
      expect(h).toMatchObject({ mode: "returning_customer", assigneeId: f.actors.agent1.id });
    });

    it("original ownership outranks scored assignment, and links the client", async () => {
      const shared = phone();
      const { clientId } = await createClient(db, f.actors.superAdmin, { name: "Kept Buyer", phoneCountryCode: "+92", phoneNumber: shared, ownerId: f.actors.agent2.id });
      const r = await lead(f.actors.manager, { projectId: f.otherProjectId, phoneNumber: shared });
      expect(await row(r.leadId)).toMatchObject({ ownerId: f.actors.agent2.id, clientId });
    });

    it("an inactive original agent no longer keeps the customer", async () => {
      const shared = phone();
      await lead(f.actors.agent1, { phoneNumber: shared });
      await db.update(users).set({ status: "inactive" }).where(eq(users.id, f.actors.agent1.id));
      const r = await lead(f.actors.manager, { projectId: f.otherProjectId, phoneNumber: shared });
      expect((await row(r.leadId)).ownerId).not.toBe(f.actors.agent1.id);
      expect((await history(r.leadId))[0].mode).toBe("scored");
    });
  });

  describe("claims", () => {
    const unassigned = async () => {
      await db.update(users).set({ status: "inactive" }).where(eq(users.role, "agent"));
      const r = await createLead(db, admin, leadInput(f, { phoneNumber: phone() }));
      await db.update(users).set({ status: "active" }).where(eq(users.role, "agent"));
      if (r.outcome !== "created") throw new Error("setup");
      expect((await row(r.leadId)).ownerId).toBeNull();
      return r.leadId;
    };

    it("two agents claiming at once: exactly one wins, and it stays theirs", async () => {
      const id = await unassigned();
      const results = await Promise.allSettled([claimLead(db, f.actors.agent1, id), claimLead(db, f.actors.agent2, id)]);
      expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
      const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect((loser.reason as AppError).code).toBe("CONFLICT");
      const owner = (await row(id)).ownerId;
      expect([f.actors.agent1.id, f.actors.agent2.id]).toContain(owner);
      expect((await history(id)).filter((h) => h.mode === "claim")).toHaveLength(1);
    });

    it("a claimed lead can't be claimed again; only an authorised reassignment changes it, and that is recorded", async () => {
      const id = await unassigned();
      await claimLead(db, f.actors.agent1, id);
      expect((await failure(claimLead(db, f.actors.agent2, id))).code).toBe("CONFLICT");
      expect((await failure(assignLead(db, f.actors.agent2, id, { ownerId: f.actors.agent2.id }))).code).toBe("FORBIDDEN");
      await assignLead(db, f.actors.manager, id, { ownerId: f.actors.agent2.id });
      const manual = (await history(id)).find((h) => h.mode === "manual");
      expect(manual).toMatchObject({ assigneeId: f.actors.agent2.id, previousOwnerId: f.actors.agent1.id, actorId: f.actors.manager.id });
    });

    it("the unassigned pool shows no phone numbers, and HR can't claim", async () => {
      const id = await unassigned();
      const pool = await listUnassigned(db, f.actors.agent1, f.projectId);
      expect(pool.map((p) => p.id)).toContain(id);
      expect(Object.keys(pool[0])).not.toContain("phoneE164");
      expect((await failure(claimLead(db, f.actors.hr, id))).code).toBe("FORBIDDEN");
    });
  });

  describe("scored assignment", () => {
    it("a manager's unassigned lead is scored among their team's agents, with the breakdown recorded", async () => {
      const r = await lead(f.actors.manager);
      expect([f.actors.agent1.id, f.actors.agent2.id]).toContain((await row(r.leadId)).ownerId);
      const [h] = await history(r.leadId);
      expect(h.mode).toBe("scored");
      const b = h.breakdown as { candidates: { userId: string; workload: number; performance: number; conversion: number; availability: number }[] };
      expect(b.candidates.map((c) => c.userId).sort()).toEqual([f.actors.agent1.id, f.actors.agent2.id].sort());
      expect(Object.keys(b.candidates[0])).toEqual(expect.arrayContaining(["workload", "performance", "conversion", "availability"]));
    });

    it("prefers the agent with spare capacity", async () => {
      for (let i = 0; i < 6; i++) await lead(f.actors.agent1);
      const r = await lead(f.actors.manager);
      expect((await row(r.leadId)).ownerId).toBe(f.actors.agent2.id);
    });

    it("skips agents on leads-off and at full load", async () => {
      const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.name, "Team 1"));
      await db.insert(rosterEntries).values({ teamId: team.id, userId: f.actors.agent1.id, date: today(), status: "leads_off" });
      const r = await lead(f.actors.manager);
      expect((await row(r.leadId)).ownerId).toBe(f.actors.agent2.id);
      const b = (await history(r.leadId))[0].breakdown as { excluded: { userId: string; reason: string }[] };
      expect(b.excluded.find((e) => e.userId === f.actors.agent1.id)?.reason).toBe("Leads off in today's roster");

      await updateAssignmentSettings(db, admin, { ...(await readAssignmentSettings(db)), maxLoad: 1 });
      const full = await lead(f.actors.manager);
      expect((await row(full.leadId)).ownerId).toBe(f.actors.manager.id);
      expect((await history(full.leadId))[0].reason).toMatch(/No eligible agent/);
    });

    it("settings must add up to 100 and only admins can change them", async () => {
      const s = await readAssignmentSettings(db);
      expect([s.weightWorkload, s.weightPerformance, s.weightConversion, s.weightAvailability]).toEqual([40, 30, 20, 10]);
      expect((await failure(updateAssignmentSettings(db, admin, { ...s, weightWorkload: 50 }))).fields?.weightWorkload).toMatch(/100/);
      expect((await failure(updateAssignmentSettings(db, f.actors.manager, s))).code).toBe("FORBIDDEN");
      await updateAssignmentSettings(db, admin, { ...s, weightWorkload: 30, weightPerformance: 40 });
      expect((await readAssignmentSettings(db)).weightPerformance).toBe(40);
      await db.update(appSettings).set({ value: "nonsense" }).where(eq(appSettings.key, "assignment.weight_workload"));
      expect((await readAssignmentSettings(db)).weightWorkload).toBe(40);
    });
  });

  describe("record-level access", () => {
    it("only the owner, their manager and admins open a lead", async () => {
      const r = await lead(f.actors.agent1);
      expect((await getLeadDetail(db, f.actors.agent1, r.leadId)).lead.id).toBe(r.leadId);
      expect((await getLeadDetail(db, f.actors.manager, r.leadId)).lead.id).toBe(r.leadId);
      expect((await getLeadDetail(db, admin, r.leadId)).lead.id).toBe(r.leadId);
      expect((await getLeadDetail(db, f.actors.superAdmin, r.leadId)).lead.id).toBe(r.leadId);
      for (const other of [f.actors.agent2, f.actors.outsideAgent, f.actors.hr]) {
        expect(["NOT_FOUND", "FORBIDDEN"]).toContain((await failure(getLeadDetail(db, other, r.leadId))).code);
      }
    });
  });

  it("history is kept for each inquiry: the customer's leads share the client", async () => {
    const shared = phone();
    const { clientId } = await createClient(db, f.actors.superAdmin, { name: "History Buyer", phoneCountryCode: "+92", phoneNumber: shared, ownerId: f.actors.agent1.id });
    const a = await lead(f.actors.manager, { phoneNumber: shared });
    const b = await lead(f.actors.manager, { projectId: f.otherProjectId, phoneNumber: shared });
    const linked = await db.select({ id: leads.id, ownerId: leads.ownerId }).from(leads).where(and(eq(leads.clientId, clientId)));
    expect(linked.map((l) => l.id).sort()).toEqual([a.leadId, b.leadId].sort());
    expect(linked.every((l) => l.ownerId === f.actors.agent1.id)).toBe(true);
    const history = await db.select().from(clientActivities).where(eq(clientActivities.clientId, clientId));
    expect(history.filter((h) => h.type === "lead_linked")).toHaveLength(2);
  });

  it("a lead given by hand to someone else is not joined to another owner's client", async () => {
    const shared = phone();
    await createClient(db, f.actors.superAdmin, { name: "Other Team Buyer", phoneCountryCode: "+92", phoneNumber: shared, ownerId: f.actors.outsideAgent.id });
    const r = await lead(f.actors.manager, { phoneNumber: shared, ownerId: f.actors.agent1.id });
    expect(await row(r.leadId)).toMatchObject({ ownerId: f.actors.agent1.id, clientId: null });
  });
});
