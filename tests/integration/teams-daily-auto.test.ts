import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { getDailyReport, getRosterDay, listTeams } from "@/modules/teams/queries";
import { saveDailyReport } from "@/modules/teams/commands";
import { attendanceRecords, files, leads, meetings, teams } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

describe.skipIf(!hasTestDb)("Daily report and roster filled from the CRM (15 Nov 2026)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let teamId: string;
  const NOW = new Date("2026-11-17T10:00:00+05:00");
  const TODAY = "2026-11-17";

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    [{ id: teamId }] = await db.select({ id: teams.id }).from(teams).where(eq(teams.name, "Team 1"));
  });

  it("starts the day's report from the CRM's figures and shows them beside corrections", async () => {
    const a = f.actors.agent1;
    const lead = await createLead(db, a, leadInput(f));
    if (lead.outcome !== "created") throw new Error("setup");
    // The lead was created now (real time); give it today's test date so it counts.
    const at = new Date(`${TODAY}T09:30:00+05:00`);
    await db.update(leads).set({ createdAt: at }).where(eq(leads.id, lead.leadId));
    await db.insert(files).values({ leadId: lead.leadId, kind: "call_recording", storageKey: "k", originalName: "c.mp3", mime: "audio/mpeg", sizeBytes: 1, sha256: "a".repeat(64), uploadedById: a.id, createdAt: at });
    await db.insert(meetings).values({ title: "Visit", startsAt: at, organizerId: a.id, leadId: lead.leadId, status: "completed", completedAt: at });

    const fresh = await getDailyReport(db, f.actors.manager, teamId, TODAY, NOW);
    expect(fresh.rows.find((r) => r.agentId === a.id)).toMatchObject({ leads: 1, calls: 1, meetings: 1, tokens: 0, bookings: 0, crm: { leads: 1, calls: 1, meetings: 1, tokens: 0, bookings: 0 } });

    // A correction keeps the CRM figure next to it; yesterday can still be confirmed, earlier days can't.
    await saveDailyReport(db, f.actors.manager, teamId, TODAY, { lines: [{ agentId: a.id, leads: 1, calls: 3, meetings: 1, tokens: 0, bookings: 0, remarks: "Two calls not recorded" }] }, NOW);
    const saved = await getDailyReport(db, f.actors.manager, teamId, TODAY, NOW);
    expect(saved.rows.find((r) => r.agentId === a.id)).toMatchObject({ calls: 3, crm: { calls: 1 }, remarks: "Two calls not recorded" });
    expect((await getDailyReport(db, f.actors.manager, teamId, "2026-11-16", NOW)).canEdit).toBe(true);
    expect((await getDailyReport(db, f.actors.manager, teamId, "2026-11-15", NOW)).canEdit).toBe(false);
  });

  it("pre-marks members who checked in as In office, and finds teams by name", async () => {
    await db.insert(attendanceRecords).values({ userId: f.actors.agent1.id, date: TODAY, checkInAt: new Date(`${TODAY}T09:05:00+05:00`) });
    const day = await getRosterDay(db, f.actors.manager, teamId, TODAY, NOW);
    expect(day.rows.find((r) => r.id === f.actors.agent1.id)).toMatchObject({ status: null, checkIn: "09:05", suggested: "in_office" });
    expect(day.rows.find((r) => r.id === f.actors.agent2.id)).toMatchObject({ checkIn: null, suggested: null });

    expect((await listTeams(db, f.actors.superAdmin, { tq: "team 2" })).rows.map((t) => t.name)).toEqual(["Team 2"]);
    expect((await listTeams(db, f.actors.superAdmin, { tstatus: "inactive" })).rows).toEqual([]);
  });
});
