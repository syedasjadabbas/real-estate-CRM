import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assignLead, createLead } from "@/modules/leads/commands";
import { getLeadDetail } from "@/modules/leads/queries";
import { setTeamMembers, updateTeam } from "@/modules/teams/commands";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, leadActivities, leads, leaveRequests, notifications, teamMembers, teams, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { businessToday } from "@/modules/bookings/today";
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

/** Fixture: Team 1 (Manager; Agent A, Agent B) and Team 2 (no manager; Agent Outside). */
describe.skipIf(!hasTestDb)("F-15: lead assignment stays inside a manager's teams (FR-029, FR-030, PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let team1: string;
  let team2: string;
  let userCounter = 0;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const rows = await db.select({ id: teams.id, name: teams.name }).from(teams);
    team1 = rows.find((t) => t.name === "Team 1")!.id;
    team2 = rows.find((t) => t.name === "Team 2")!.id;
  });

  const makeUser = async (name: string, role: "manager" | "agent" | "admin") => {
    userCounter += 1;
    const [u] = await db.insert(users).values({ name, email: `assign${userCounter}@test.local`, role, passwordHash: "x" }).returning();
    return u;
  };
  const reload = (a: Actor) => loadActor(db, { id: a.id, name: a.name, email: a.email, role: a.role });
  /** Gives Team 2 a manager and returns them as an actor. */
  const managerOfTeam2 = async () => {
    const u = await makeUser("Second Manager", "manager");
    await db.update(teams).set({ managerId: u.id }).where(eq(teams.id, team2));
    return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  };
  const autoAssign = async (actor: Actor) => {
    const r = await createLead(db, actor, leadInput(f));
    if (r.outcome !== "created") throw new Error("lead");
    const [row] = await db.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, r.leadId));
    return { leadId: r.leadId, ownerId: row.ownerId };
  };
  const owners = async (actor: Actor, n: number) => {
    const out: (string | null)[] = [];
    for (let i = 0; i < n; i += 1) out.push((await autoAssign(actor)).ownerId);
    return out;
  };

  describe("Auto-assign", () => {
    it("a manager's auto-assign spreads across their own team only, and they can open every lead", async () => {
      const { manager, agent1, agent2 } = f.actors;
      const made: string[] = [];
      for (let i = 0; i < 4; i += 1) made.push((await autoAssign(manager)).leadId);
      const rows = await Promise.all(made.map(async (id) => (await db.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, id)))[0].ownerId));
      expect(new Set(rows)).toEqual(new Set([agent1.id, agent2.id]));
      for (const id of made) expect((await getLeadDetail(db, manager, id)).lead.id).toBe(id);
    });

    it("keeps the timeline entry, audit row and owner's notification", async () => {
      const { leadId, ownerId } = await autoAssign(f.actors.manager);
      const activity = await db.select().from(leadActivities).where(and(eq(leadActivities.leadId, leadId), eq(leadActivities.type, "assignment")));
      expect(activity).toEqual([expect.objectContaining({ actorId: null, data: expect.objectContaining({ mode: "scored", ownerId }) })]);
      const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "lead.create"), eq(auditLogs.entityId, leadId)));
      expect(audit).toMatchObject({ actorId: f.actors.manager.id, after: expect.objectContaining({ ownerId }) });
      const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, ownerId!), eq(notifications.type, "lead_assigned")));
      expect(note.body).toMatch(/auto-assigned/);
    });

    it("stays even when another team's rotation runs in between", async () => {
      const { manager, agent1, agent2 } = f.actors;
      const second = await managerOfTeam2();
      const extra = await makeUser("Agent Outside Two", "agent");
      await db.insert(teamMembers).values({ teamId: team2, userId: extra.id });

      const mine: (string | null)[] = [];
      const theirs: (string | null)[] = [];
      for (let i = 0; i < 4; i += 1) {
        mine.push((await autoAssign(manager)).ownerId);
        theirs.push((await autoAssign(second)).ownerId);
      }
      expect(new Set(mine)).toEqual(new Set([agent1.id, agent2.id]));
      expect(new Set(theirs)).toEqual(new Set([f.actors.outsideAgent.id, extra.id]));
    });

    it("an admin's auto-assign can reach any team, while the manager's stays inside theirs", async () => {
      const { manager, superAdmin, agent1, agent2, outsideAgent } = f.actors;
      const all = [agent1.id, agent2.id, outsideAgent.id];
      for (let i = 0; i < 3; i += 1) {
        expect(all).toContain((await autoAssign(superAdmin)).ownerId);
        expect([agent1.id, agent2.id]).toContain((await autoAssign(manager)).ownerId);
      }
    });

    it("covers all the manager's active teams, but not an inactive one", async () => {
      await db.update(teams).set({ managerId: f.actors.manager.id }).where(eq(teams.id, team2));
      const manager = await reload(f.actors.manager);
      const { agent1, agent2, outsideAgent } = f.actors;
      expect(new Set(await owners(manager, 3))).toEqual(new Set([agent1.id, agent2.id, outsideAgent.id]));
      await updateTeam(db, f.actors.superAdmin, team2, { isActive: false });
      for (const o of await owners(manager, 2)) expect([agent1.id, agent2.id]).toContain(o);
    });

    it("skips agents on leave, and keeps the lead with the manager when no team agent can take it", async () => {
      const { manager, agent1, agent2 } = f.actors;
      const today = businessToday();
      await db.insert(leaveRequests).values({ userId: agent1.id, type: "annual", startDate: today, endDate: today, days: 1, status: "approved", approvalPath: "staff" });
      expect(await owners(manager, 2)).toEqual([agent2.id, agent2.id]);
      await db.insert(leaveRequests).values({ userId: agent2.id, type: "annual", startDate: today, endDate: today, days: 1, status: "approved", approvalPath: "staff" });
      expect(await owners(manager, 1)).toEqual([manager.id]);
    });

    it("a manager with no team keeps the lead rather than reaching another team", async () => {
      const u = await makeUser("Teamless Manager", "manager");
      const actor = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
      expect(await owners(actor, 1)).toEqual([actor.id]);
    });

    it("Admin and Super Admin auto-assign covers all active teams", async () => {
      const [u] = await db.insert(users).values({ name: "Zed Admin", email: "zed@test.local", role: "admin", passwordHash: "x" }).returning();
      const admin = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
      const { agent1, agent2, outsideAgent, superAdmin } = f.actors;
      const picked = [...(await owners(superAdmin, 2)), ...(await owners(admin, 2))];
      for (const o of picked) expect([agent1.id, agent2.id, outsideAgent.id]).toContain(o);
      expect(new Set(picked).size).toBe(3);
    });
  });

  describe("manual assignment", () => {
    it("a manager can choose their team or themselves, not an outsider; a refusal writes nothing", async () => {
      const { manager, agent2, outsideAgent } = f.actors;
      const inTeam = await createLead(db, manager, leadInput(f, { ownerId: agent2.id }));
      expect(inTeam.outcome).toBe("created");
      expect((await createLead(db, manager, leadInput(f, { ownerId: manager.id }))).outcome).toBe("created");

      const before = (await db.select().from(leads)).length;
      const auditsBefore = (await db.select().from(auditLogs)).length;
      expect(await errorCode(createLead(db, manager, leadInput(f, { ownerId: outsideAgent.id })))).toBe("FORBIDDEN");
      const { leadId } = await autoAssign(manager);
      const auditsAfterCreate = (await db.select().from(auditLogs)).length;
      expect(await errorCode(assignLead(db, manager, leadId, { ownerId: outsideAgent.id }))).toBe("FORBIDDEN");
      expect((await db.select().from(leads)).length).toBe(before + 1);
      expect(auditsAfterCreate).toBeGreaterThan(auditsBefore);
      expect((await db.select().from(auditLogs)).length).toBe(auditsAfterCreate);
    });

    it("a manager's reassignment inside the team keeps its history", async () => {
      const { manager, agent1, agent2 } = f.actors;
      const { leadId, ownerId: first } = await autoAssign(manager);
      const next = first === agent1.id ? agent2.id : agent1.id;
      await assignLead(db, manager, leadId, { ownerId: next });
      const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "lead.assign"), eq(auditLogs.entityId, leadId)));
      expect(audit).toMatchObject({ before: { ownerId: first }, after: { ownerId: next } });
      expect((await db.select().from(leadActivities).where(and(eq(leadActivities.leadId, leadId), eq(leadActivities.type, "assignment")))).map((a) => (a.data as { mode: string }).mode).sort()).toEqual(["manual", "scored"]);
    });

    it("admins may still assign anyone; agents can't assign and always own what they create; HR can't create", async () => {
      const { superAdmin, agent1, outsideAgent, hr } = f.actors;
      const r = await createLead(db, superAdmin, leadInput(f, { ownerId: outsideAgent.id }));
      if (r.outcome !== "created") throw new Error("lead");
      await assignLead(db, superAdmin, r.leadId, { ownerId: agent1.id });
      expect((await db.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, r.leadId)))[0].ownerId).toBe(agent1.id);

      const own = await createLead(db, agent1, leadInput(f, { ownerId: outsideAgent.id }));
      if (own.outcome !== "created") throw new Error("lead");
      expect((await db.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, own.leadId)))[0].ownerId).toBe(agent1.id);
      expect(await errorCode(assignLead(db, agent1, own.leadId, { ownerId: f.actors.agent2.id }))).toBe("FORBIDDEN");
      expect(await errorCode(createLead(db, hr, leadInput(f)))).toBe("FORBIDDEN");
    });
  });

  describe("team changes", () => {
    it("uses the teams as they are now, not as they were at sign-in", async () => {
      const stale = f.actors.manager; // managedTeamIds still lists Team 1
      const { leadId } = await autoAssign(stale);
      await updateTeam(db, f.actors.superAdmin, team1, { managerId: null });
      expect(await owners(stale, 1)).toEqual([stale.id]);
      expect(await errorCode(createLead(db, stale, leadInput(f, { ownerId: f.actors.agent1.id })))).toBe("FORBIDDEN");
      await db.update(leads).set({ ownerId: stale.id }).where(eq(leads.id, leadId));
      expect(await errorCode(assignLead(db, stale, leadId, { ownerId: f.actors.agent1.id }))).toBe("FORBIDDEN");
    });

    /** Runs `during` while another transaction holds Team 1's lock with `change` applied, then commits it. */
    const whileTeamChanges = async <T>(change: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<unknown>, during: () => Promise<T>) => {
      let release = () => {};
      let locked = () => {};
      const gate = new Promise<void>((r) => (release = r));
      const held = new Promise<void>((r) => (locked = r));
      const commit = db.transaction(async (tx) => {
        await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, team1)).for("update");
        await change(tx);
        locked();
        await gate;
      });
      await held;
      const running = during();
      await new Promise((r) => setTimeout(r, 200));
      release();
      await commit;
      return running;
    };

    it("Auto-assign waits for a team change in progress, so it can't pick the agent being removed", async () => {
      const { manager, agent1, agent2 } = f.actors;
      const { ownerId } = await whileTeamChanges((tx) => tx.delete(teamMembers).where(and(eq(teamMembers.teamId, team1), eq(teamMembers.userId, agent1.id))), () => autoAssign(manager));
      expect(ownerId).toBe(agent2.id);
    });

    it("manual assignment waits too, and is refused once the agent has left", async () => {
      const { manager, agent1 } = f.actors;
      const code = await whileTeamChanges(
        (tx) => tx.delete(teamMembers).where(and(eq(teamMembers.teamId, team1), eq(teamMembers.userId, agent1.id))),
        () => errorCode(createLead(db, manager, leadInput(f, { ownerId: agent1.id }))),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("assignments and a member change at the same time leave no error and no outsider", async () => {
      const { manager, superAdmin, agent1, agent2 } = f.actors;
      const results = await Promise.all([autoAssign(manager), setTeamMembers(db, superAdmin, team1, { userIds: [manager.id, agent2.id] }), autoAssign(manager), autoAssign(manager)]);
      const assigned = [results[0], results[2], results[3]].map((r) => (r as { ownerId: string }).ownerId);
      for (const id of assigned) expect([agent1.id, agent2.id]).toContain(id);
    });
  });

  it("simultaneous Auto-assigns share the team evenly", async () => {
    const { manager, agent1, agent2 } = f.actors;
    const assigned = (await Promise.all(Array.from({ length: 6 }, () => autoAssign(manager)))).map((r) => r.ownerId);
    expect(assigned.filter((id) => id === agent1.id)).toHaveLength(3);
    expect(assigned.filter((id) => id === agent2.id)).toHaveLength(3);
  });
});
