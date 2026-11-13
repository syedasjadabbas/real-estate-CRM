import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addClientNote,
  assignClient,
  completeClientFollowUp,
  convertLeadToClient,
  createClient,
  scheduleClientFollowUp,
  updateClient,
} from "@/modules/clients/commands";
import { clientStatusForLead, getClientDetail, listClients } from "@/modules/clients/queries";
import { assignLead, createLead } from "@/modules/leads/commands";
import { getLeadDetail } from "@/modules/leads/queries";
import { loadActor } from "@/server/auth/session-store";
import { hashPassword } from "@/server/auth/password";
import { auditLogs, clientActivities, clients, leads, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
};
const errorCode = async (p: Promise<unknown>) => (await errorOf(p))?.code ?? "ok";

describe.skipIf(!hasTestDb)("Clients module (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let accountant: Actor;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [u] = await db
      .insert(users)
      .values({ name: "Accountant", email: "acc@test.local", role: "accountant", passwordHash: await hashPassword("x-y-z-w-v") })
      .returning();
    accountant = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  });

  /** Creates a lead owned by `owner` (agents own what they create). */
  const leadOf = async (owner: Actor, overrides: Record<string, unknown> = {}) => {
    const r = await createLead(db, owner, leadInput(f, overrides));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };

  describe("lead conversion and duplicates", () => {
    it("every new lead creates its person's client, with history and audit; converting returns it", async () => {
      // A client is the person; each lead is one of their inquiries (13 Nov 2026).
      const leadId = await leadOf(f.actors.agent1, { email: "buyer@example.com" });
      const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
      expect(lead.clientId).not.toBeNull();
      const clientId = lead.clientId!;

      const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
      expect(client).toMatchObject({ ownerId: f.actors.agent1.id, email: "buyer@example.com", createdById: f.actors.agent1.id });
      const acts = await db.select().from(clientActivities).where(eq(clientActivities.clientId, clientId));
      expect(acts.map((a) => a.type)).toEqual(["created"]);
      const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, clientId));
      expect(audit.map((a) => a.action)).toEqual(["client.create_from_lead"]);

      expect(await convertLeadToClient(db, f.actors.manager, { leadId })).toEqual({ outcome: "linked", clientId });
      expect((await getLeadDetail(db, f.actors.agent1, leadId)).lead.clientId).toBe(clientId);
    });

    it("keeps one client per phone across projects: a new inquiry joins the person's client", async () => {
      const first = await leadOf(f.actors.agent1, { phoneNumber: "0300 7770001" });
      const second = await leadOf(f.actors.agent1, { phoneNumber: "+92 300 777 0001", projectId: f.otherProjectId });
      const [a] = await db.select().from(leads).where(eq(leads.id, first));
      const [b] = await db.select().from(leads).where(eq(leads.id, second));
      expect(b.clientId).toBe(a.clientId);
      expect((await db.select().from(clients)).length).toBe(1);
      const detail = await getClientDetail(db, f.actors.manager, a.clientId!);
      expect(detail.linkedLeads.map((l) => l.id).sort()).toEqual([first, second].sort());
      expect(detail.activities.map((x) => x.type)).toEqual(["lead_linked", "created"]);
      expect(detail.interests.map((g) => g.status)).toEqual(["interested", "interested"]);
    });

    it("keeps another team's customer with their agent: their new inquiry can't be handed to someone else", async () => {
      const outsideLead = await leadOf(f.actors.outsideAgent, { phoneNumber: "0300 7770002" });
      const [original] = await db.select().from(leads).where(eq(leads.id, outsideLead));
      const refused = await errorOf(createLead(db, f.actors.manager, leadInput(f, { phoneNumber: "0300 7770002", projectId: f.otherProjectId, ownerId: f.actors.agent1.id })));
      expect(refused?.code).toBe("VALIDATION_FAILED");
      expect(refused?.fields?.ownerId).toContain("Agent Outside");

      const again = await createLead(db, f.actors.manager, leadInput(f, { phoneNumber: "0300 7770002", projectId: f.otherProjectId }));
      if (again.outcome !== "created") throw new Error("setup");
      expect(again.visible).toBe(false);
      const [lead] = await db.select().from(leads).where(eq(leads.id, again.leadId));
      expect(lead).toMatchObject({ ownerId: f.actors.outsideAgent.id, clientId: original.clientId });
      expect(await clientStatusForLead(db, f.actors.manager, lead)).toEqual({ status: "linked", client: null });
    });

    it("lets admins add clients manually and rejects the same phone in another format", async () => {
      const invalid = await errorOf(createClient(db, f.actors.superAdmin, { name: "", phoneCountryCode: "+92", phoneNumber: "12" }));
      expect(invalid?.code).toBe("VALIDATION_FAILED");
      expect(Object.keys(invalid?.fields ?? {})).toEqual(expect.arrayContaining(["name", "phoneNumber"]));

      const { clientId } = await createClient(db, f.actors.superAdmin, {
        name: "Walk-in Buyer",
        phoneCountryCode: "+92",
        phoneNumber: "0300 7770003",
        relationship: "investor",
        ownerId: f.actors.agent2.id,
      });
      const dup = await errorOf(createClient(db, f.actors.superAdmin, { name: "Same", phoneCountryCode: "92", phoneNumber: "3007770003" }));
      expect(dup?.code).toBe("CONFLICT");
      expect(dup?.details).toMatchObject({ existingClientId: clientId });
      expect((await getClientDetail(db, f.actors.agent2, clientId)).client).toMatchObject({ relationship: "investor", ownerId: f.actors.agent2.id });
    });
  });

  describe("permissions", () => {
    it("scopes visibility: own (agent), team (manager), all (admin, accountant), none (HR)", async () => {
      const a1 = (await convertLeadToClient(db, f.actors.superAdmin, { leadId: await leadOf(f.actors.agent1) })).clientId;
      const a2 = (await convertLeadToClient(db, f.actors.superAdmin, { leadId: await leadOf(f.actors.agent2) })).clientId;
      const out = (await convertLeadToClient(db, f.actors.superAdmin, { leadId: await leadOf(f.actors.outsideAgent) })).clientId;
      const ids = async (actor: Actor) => (await listClients(db, actor, {})).rows.map((r) => r.id).sort();

      expect(await ids(f.actors.agent1)).toEqual([a1]);
      expect(await ids(f.actors.manager)).toEqual([a1, a2].sort());
      expect(await ids(f.actors.superAdmin)).toEqual([a1, a2, out].sort());
      expect(await ids(accountant)).toEqual([a1, a2, out].sort());
      expect(await errorCode(listClients(db, f.actors.hr, {}))).toBe("FORBIDDEN");

      expect(await errorCode(getClientDetail(db, f.actors.agent2, a1))).toBe("NOT_FOUND");
      expect(await errorCode(getClientDetail(db, f.actors.manager, out))).toBe("NOT_FOUND");
      expect(await errorCode(updateClient(db, f.actors.agent2, a1, { name: "Hijack" }))).toBe("NOT_FOUND");
      expect(await errorCode(addClientNote(db, f.actors.manager, out, { body: "x" }))).toBe("NOT_FOUND");
      expect(await errorCode(getClientDetail(db, f.actors.hr, a1))).toBe("FORBIDDEN");
    });

    it("blocks creation and edits for roles without them", async () => {
      const leadId = await leadOf(f.actors.agent1);
      expect(await errorCode(convertLeadToClient(db, f.actors.agent1, { leadId }))).toBe("FORBIDDEN");
      expect(await errorCode(convertLeadToClient(db, accountant, { leadId }))).toBe("FORBIDDEN");
      expect(await errorCode(createClient(db, f.actors.manager, { name: "Nope", phoneCountryCode: "+92", phoneNumber: "3007770009" }))).toBe("FORBIDDEN");
      const { clientId } = await convertLeadToClient(db, f.actors.manager, { leadId });
      expect(await errorCode(updateClient(db, accountant, clientId, { name: "Read only" }))).toBe("FORBIDDEN");
      expect(await errorCode(assignClient(db, f.actors.agent1, clientId, { ownerId: f.actors.agent2.id }))).toBe("FORBIDDEN");
      // A manager cannot convert a lead outside their team (it is not visible to them).
      expect(await errorCode(convertLeadToClient(db, f.actors.manager, { leadId: await leadOf(f.actors.outsideAgent) }))).toBe("NOT_FOUND");
    });

    it("lets a manager reassign within the team but not outside it", async () => {
      const { clientId } = await convertLeadToClient(db, f.actors.manager, { leadId: await leadOf(f.actors.agent1) });
      await assignClient(db, f.actors.manager, clientId, { ownerId: f.actors.agent2.id });
      expect((await getClientDetail(db, f.actors.agent2, clientId)).client.ownerId).toBe(f.actors.agent2.id);
      expect(await errorCode(getClientDetail(db, f.actors.agent1, clientId))).toBe("NOT_FOUND");
      expect(await errorCode(assignClient(db, f.actors.manager, clientId, { ownerId: f.actors.outsideAgent.id }))).toBe("FORBIDDEN");
    });

    it("lists only the linked leads the viewer could open in Leads", async () => {
      const teamLead = await leadOf(f.actors.agent1, { phoneNumber: "0300 7770004" });
      // The person's next inquiry goes to their agent; a Super Admin later moves it to another team.
      const outsideLead = await leadOf(f.actors.superAdmin, { phoneNumber: "0300 7770004", projectId: f.otherProjectId });
      await assignLead(db, f.actors.superAdmin, outsideLead, { ownerId: f.actors.outsideAgent.id });
      const [lead] = await db.select().from(leads).where(eq(leads.id, teamLead));
      const clientId = lead.clientId!;

      const forManager = await getClientDetail(db, f.actors.manager, clientId);
      expect(forManager.linkedLeads.map((l) => l.id)).toEqual([teamLead]);
      expect(forManager.hiddenLeadCount).toBe(1);
      expect((await getClientDetail(db, f.actors.superAdmin, clientId)).linkedLeads).toHaveLength(2);
      expect((await getClientDetail(db, accountant, clientId)).linkedLeads).toHaveLength(0);
    });
  });

  describe("profile, notes and follow-ups", () => {
    it("persists partial edits with history and refuses another client's phone", async () => {
      const { clientId } = await convertLeadToClient(db, f.actors.manager, { leadId: await leadOf(f.actors.agent1) });
      await createClient(db, f.actors.superAdmin, { name: "Other", phoneCountryCode: "+92", phoneNumber: "3007770005" });

      // The lead already had a city, so only the relationship changes.
      expect(await updateClient(db, f.actors.agent1, clientId, { relationship: "repeat_investor", cityId: f.cityId })).toEqual({
        changed: ["relationship"],
      });
      await updateClient(db, f.actors.agent1, clientId, { name: "Renamed Client" });
      const detail = await getClientDetail(db, f.actors.agent1, clientId);
      expect(detail.client).toMatchObject({ name: "Renamed Client", relationship: "repeat_investor", cityName: "Islamabad" });

      await updateClient(db, f.actors.agent1, clientId, { relationship: "" });
      expect((await getClientDetail(db, f.actors.agent1, clientId)).client.relationship).toBeNull();

      const clash = await errorOf(updateClient(db, f.actors.agent1, clientId, { phoneNumber: "0300-7770005" }));
      expect(clash?.code).toBe("CONFLICT");
      expect(clash?.fields).toHaveProperty("phoneNumber");
      const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, clientId));
      expect(audit.filter((a) => a.action === "client.update")).toHaveLength(3);
    });

    it("schedules and completes follow-ups, keeps next follow-up in sync, and records notes", async () => {
      const { clientId } = await convertLeadToClient(db, f.actors.manager, { leadId: await leadOf(f.actors.agent1) });
      const now = new Date();
      const soon = new Date(now.getTime() + 2 * 3_600_000);
      const later = new Date(now.getTime() + 48 * 3_600_000);
      expect(await errorCode(scheduleClientFollowUp(db, f.actors.agent1, clientId, { dueAt: new Date(now.getTime() - 3_600_000).toISOString() }))).toBe(
        "VALIDATION_FAILED",
      );
      await scheduleClientFollowUp(db, f.actors.agent1, clientId, { dueAt: later.toISOString() });
      const second = await scheduleClientFollowUp(db, f.actors.agent1, clientId, { dueAt: soon.toISOString(), note: "Payment plan call" });
      let [row] = await db.select().from(clients).where(eq(clients.id, clientId));
      expect(row.nextFollowUpAt?.getTime()).toBe(soon.getTime());

      expect(await errorCode(completeClientFollowUp(db, f.actors.agent2, second.id))).toBe("NOT_FOUND");
      await completeClientFollowUp(db, f.actors.agent1, second.id);
      [row] = await db.select().from(clients).where(eq(clients.id, clientId));
      expect(row.nextFollowUpAt?.getTime()).toBe(later.getTime());
      expect(await errorCode(completeClientFollowUp(db, f.actors.agent1, second.id))).toBe("BUSINESS_RULE");

      await addClientNote(db, f.actors.agent1, clientId, { body: "Asked for the payment schedule" });
      expect(await errorCode(addClientNote(db, f.actors.agent1, clientId, { body: "  " }))).toBe("VALIDATION_FAILED");
      const detail = await getClientDetail(db, f.actors.agent1, clientId);
      expect(detail.activities.map((a) => a.type)).toEqual(["note", "follow_up_done", "follow_up_scheduled", "follow_up_scheduled", "created"]);
      expect(detail.followUps.map((x) => x.status)).toEqual(["pending", "done"]);
    });

    it("searches by name, email and phone digits, and sorts by name", async () => {
      await createClient(db, f.actors.superAdmin, { name: "Zara Khan", phoneCountryCode: "+92", phoneNumber: "3007770006", email: "zara@example.com" });
      await createClient(db, f.actors.superAdmin, { name: "Ahmed Ali", phoneCountryCode: "+92", phoneNumber: "3007770007" });
      const names = async (q: Record<string, string>) => (await listClients(db, f.actors.superAdmin, q)).rows.map((r) => r.name);
      expect(await names({ q: "zara@" })).toEqual(["Zara Khan"]);
      expect(await names({ q: "0300 777 0007" })).toEqual(["Ahmed Ali"]);
      expect(await names({ q: "nobody" })).toEqual([]);
      expect(await names({ sort: "name", dir: "asc" })).toEqual(["Ahmed Ali", "Zara Khan"]);
    });
  });
});
