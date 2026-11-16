import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { employeeProfile } from "@/modules/people/profile";
import { employeeProfileCsv } from "@/modules/people/export";
import { addEmployeeNote } from "@/modules/people/notes";
import { setTeamLead, setTeamMembers } from "@/modules/teams/commands";
import { myTeamView } from "@/modules/teams/my-team";
import { setTarget } from "@/modules/targets/service";
import { businessToday } from "@/modules/bookings/today";
import { loadActor } from "@/server/auth/session-store";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { auditLogs, files, followUps, leads, projects, teamMembers, teams, users } from "@/server/db/schema";
import { listLeads } from "@/modules/leads/queries";
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

describe.skipIf(!hasTestDb)("Team Lead and employee profile (owner, 15 Nov 2026)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;
  let teamId: string;
  const reload = (a: Actor) => loadActor(db, { id: a.id, name: a.name, email: a.email, role: a.role });

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [u] = await db.insert(users).values({ name: "Zed Admin", email: "admin@test.local", role: "admin", passwordHash: "x" }).returning();
    admin = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    [{ id: teamId }] = await db.select({ id: teams.id }).from(teams).where(eq(teams.name, "Team 1"));
  });

  it("Admins appoint a Team Lead from the team's active agents; leaving the team clears it", async () => {
    expect((await errorOf(setTeamLead(db, f.actors.agent1, teamId, { userId: f.actors.agent1.id })))?.code).toBe("FORBIDDEN");
    expect((await errorOf(setTeamLead(db, admin, teamId, { userId: f.actors.outsideAgent.id })))?.fields?.userId).toMatch(/in this team/);
    expect((await errorOf(setTeamLead(db, admin, teamId, { userId: f.actors.manager.id })))?.fields?.userId).toMatch(/agent/);
    expect(await setTeamLead(db, admin, teamId, { userId: f.actors.agent1.id })).toEqual({ changed: true });
    expect((await reload(f.actors.agent1)).ledTeamIds).toEqual([teamId]);
    expect((await reload(f.actors.agent2)).ledTeamIds).toEqual([]);
    expect(await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.action, "team.lead"))).toHaveLength(1);

    const keep = (await db.select({ id: teamMembers.userId }).from(teamMembers).where(eq(teamMembers.teamId, teamId))).map((r) => r.id).filter((id) => id !== f.actors.agent1.id);
    await setTeamMembers(db, admin, teamId, { userIds: keep });
    const [team] = await db.select({ lead: teams.teamLeadId }).from(teams).where(eq(teams.id, teamId));
    expect(team.lead).toBeNull();
  });

  it("a Team Lead sees the team read-only; other agents have no team view", async () => {
    await setTeamLead(db, admin, teamId, { userId: f.actors.agent1.id });
    const lead = await reload(f.actors.agent1);
    const mine = await createLead(db, lead, leadInput(f));
    const theirs = await createLead(db, f.actors.agent2, leadInput(f, { phoneNumber: "0300-7777777" }));
    if (mine.outcome !== "created" || theirs.outcome !== "created") throw new Error("setup");

    const v = await myTeamView(db, lead, undefined);
    expect(v.team.id).toBe(teamId);
    expect(v.members.map((m) => m.id).sort()).toEqual([f.actors.agent1.id, f.actors.agent2.id].sort());
    expect(v.openLeads.map((l) => [l.id, l.mine]).sort()).toEqual([[mine.leadId, true], [theirs.leadId, false]].sort());
    expect((await errorOf(myTeamView(db, await reload(f.actors.agent2), undefined)))?.code).toBe("FORBIDDEN");
    expect((await errorOf(myTeamView(db, admin, undefined)))?.code).toBe("FORBIDDEN");

    // Filters on the open leads (16 Nov 2026): agent, search by code, overdue follow-up, paging.
    const theirsCode = v.openLeads.find((l) => l.id === theirs.leadId)!.code;
    expect((await myTeamView(db, lead, undefined, { lagent: f.actors.agent2.id })).openLeads.map((l) => l.id)).toEqual([theirs.leadId]);
    expect((await myTeamView(db, lead, undefined, { lq: theirsCode })).openLeads.map((l) => l.id)).toEqual([theirs.leadId]);
    await db.update(leads).set({ nextFollowUpAt: new Date(Date.now() - 3_600_000) }).where(eq(leads.id, mine.leadId));
    const overdue = await myTeamView(db, lead, undefined, { ldue: "overdue" });
    expect(overdue.openLeads.map((l) => l.id)).toEqual([mine.leadId]);
    expect(overdue).toMatchObject({ openTotal: 2, leadMatches: 1, leadPage: { page: 1, pageCount: 1 } });
    // An agent outside the team is ignored rather than leaking their leads.
    expect((await myTeamView(db, lead, undefined, { lagent: admin.id })).leadMatches).toBe(2);
  });

  it("a Team Lead sees each agent's win %, follow-up %, score and the targets running now (16 Nov 2026)", async () => {
    await setTeamLead(db, admin, teamId, { userId: f.actors.agent1.id });
    const lead = await reload(f.actors.agent1);
    await setTarget(db, admin, { userId: f.actors.agent2.id, period: "monthly", anchor: businessToday(new Date()), calls: 20, meetings: 4 });

    const v = await myTeamView(db, lead, undefined);
    const them = v.members.find((m) => m.id === f.actors.agent2.id)!;
    expect(typeof them.score).toBe("number");
    expect(them).toHaveProperty("scoreProvisional", true);
    expect(them.metrics).toHaveProperty("winPct");
    expect(them.metrics).toHaveProperty("fuPct");
    expect(them.targetsNow.map((t) => t.period)).toEqual(["monthly"]);
    expect(them.targetsNow[0]).toMatchObject({ goals: { calls: 20, meetings: 4 }, achieved: { calls: 0, meetings: 0 } });
    // No target for the Team Lead themself: nothing listed for them.
    expect(v.members.find((m) => m.id === f.actors.agent1.id)!.targetsNow).toEqual([]);
  });

  it("work-profile links list an agent's leads from every project, like the profile counts (16 Nov 2026)", async () => {
    const [other] = await db.insert(projects).values({ name: "Second Project" }).returning({ id: projects.id });
    const a = await createLead(db, f.actors.agent2, leadInput(f, { phoneNumber: "0300-6666601" }));
    const b = await createLead(db, f.actors.agent2, { ...leadInput(f, { phoneNumber: "0300-6666602" }), projectId: other.id });
    if (a.outcome !== "created" || b.outcome !== "created") throw new Error("setup");
    const ids = async (projectId: string | null) => (await listLeads(db, admin, projectId, { owner: f.actors.agent2.id })).rows.map((r) => r.id).sort();
    expect(await ids(f.projectId)).toEqual([a.leadId]);
    expect(await ids(null)).toEqual([a.leadId, b.leadId].sort());
    // The agent's own scope still applies across projects: another agent sees none of them.
    expect((await listLeads(db, f.actors.agent1, null, { owner: f.actors.agent2.id })).rows).toEqual([]);
  });

  it("Admins and Super Admins open an agent's full profile: calls, minutes, pipeline, follow-ups", async () => {
    const a1 = f.actors.agent1;
    const created = await createLead(db, a1, leadInput(f));
    if (created.outcome !== "created") throw new Error("setup");
    await db.insert(files).values([
      { leadId: created.leadId, kind: "call_recording", storageKey: "k1", originalName: "a.mp3", mime: "audio/mpeg", sizeBytes: 1, durationSec: 95, sha256: "a".repeat(64), uploadedById: a1.id },
      { leadId: created.leadId, kind: "call_recording", storageKey: "k2", originalName: "b.mp3", mime: "audio/mpeg", sizeBytes: 1, durationSec: 20, sha256: "b".repeat(64), uploadedById: a1.id },
    ]);
    await db.insert(followUps).values({ leadId: created.leadId, assigneeId: a1.id, dueAt: new Date(Date.now() - 86_400_000), createdById: a1.id });

    for (const actor of [a1, f.actors.hr, f.actors.manager]) expect((await errorOf(employeeProfile(db, actor, a1.id)))?.code).toBe("FORBIDDEN");
    const p = await employeeProfile(db, admin, a1.id);
    expect(p.person.name).toBe(a1.name);
    expect(p.metrics).toMatchObject({ calls: 2, callsVerified: 1, callsQualified: 1, callMin: 2 });
    expect(p.recordings).toHaveLength(2);
    expect(p.pipeline.find((s) => s.stage === "new_lead")?.count).toBe(1);
    expect(p.followUps.overdue).toBe(1);
    expect(p.teams.map((t) => t.name)).toEqual(["Team 1"]);
    expect((await employeeProfile(db, f.actors.superAdmin, a1.id)).person.id).toBe(a1.id);
    expect((await errorOf(employeeProfile(db, admin, "00000000-0000-4000-8000-000000000000")))?.code).toBe("NOT_FOUND");

    // The whole record downloads as CSV for Admins and Super Admins, and is audited (15 Nov 2026).
    expect((await errorOf(employeeProfileCsv(db, a1, a1.id, {})))?.code).toBe("FORBIDDEN");
    // Coaching notes never go into the file (owner, 16 Nov 2026): it may be handed to the employee.
    await addEmployeeNote(db, admin, a1.id, { body: "Private coaching note xyz" });
    const file = await employeeProfileCsv(db, admin, a1.id, {});
    expect(file.body).not.toContain("Private coaching note xyz");
    expect(file.body).not.toContain("Coaching notes");
    expect(file.filename).toMatch(/^work-record-.+.csv$/);
    expect(file.body).toContain("Calls,Calls (recordings),2");
    expect(file.body).toContain("Calls,Qualified (60s+),1");
    expect(file.body).toContain("Follow-ups,Overdue now,1");
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "people.export"))).length).toBe(1);
  });
});
