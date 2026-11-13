import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { cancelMeeting, completeMeeting, createMeeting, updateMeeting } from "@/modules/meetings/commands";
import { getMeetingDetail, listMeetings, meetingFormOptions, meetingsForLead, overdueMeetings } from "@/modules/meetings/queries";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, leadActivities, leads, meetingHistory, meetings, users } from "@/server/db/schema";
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
const fieldOf = async (p: Promise<unknown>) => Object.keys((await errorOf(p))?.fields ?? {})[0] ?? null;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe.skipIf(!hasTestDb)("Meetings module (PostgreSQL integration)", () => {
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

  const leadOf = async (owner: Actor) => {
    const r = await createLead(db, owner, leadInput(f));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };
  const schedule = (actor: Actor, leadId: string, extra: Record<string, unknown> = {}) =>
    createMeeting(db, actor, { title: "Site visit", type: "site_visit", startsAt: inHours(24), leadId, ...extra });
  const lead = async (id: string) => (await db.select().from(leads).where(eq(leads.id, id)))[0];
  const meeting = async (id: string) => (await db.select().from(meetings).where(eq(meetings.id, id)))[0];
  const setStage = (id: string, stage: (typeof leads.$inferSelect)["stage"]) => db.update(leads).set({ stage }).where(eq(leads.id, id));
  const history = async (id: string) => (await db.select().from(meetingHistory).where(eq(meetingHistory.meetingId, id))).map((h) => h.action).sort();

  it("schedules a meeting: organizer defaults to the creator, lead touched, timeline + history + audit", async () => {
    const leadId = await leadOf(f.actors.agent1);
    expect((await lead(leadId)).firstTouchAt).toBeNull();
    const { meetingId, movedLead } = await schedule(f.actors.agent1, leadId, { location: "Head office", endsAt: inHours(25), moveLead: false });
    const m = await meeting(meetingId);
    expect(m).toMatchObject({ organizerId: f.actors.agent1.id, createdById: f.actors.agent1.id, status: "scheduled", location: "Head office" });
    expect(movedLead).toBe(false);
    const l = await lead(leadId);
    expect(l.firstTouchAt).not.toBeNull();
    expect(l.stage).toBe("new_lead");
    const acts = await db.select().from(leadActivities).where(and(eq(leadActivities.leadId, leadId), eq(leadActivities.type, "meeting")));
    expect(acts).toHaveLength(1);
    expect(acts[0].data).toMatchObject({ action: "scheduled", meetingId });
    expect(await history(meetingId)).toEqual(["create"]);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.entityId, meetingId)))[0].action).toBe("meeting.create");
  });

  it("D2: moves the lead to Meeting Scheduled only forward, with a stage-change entry", async () => {
    const a = await leadOf(f.actors.agent1);
    expect((await schedule(f.actors.agent1, a)).movedLead).toBe(true);
    expect((await lead(a)).stage).toBe("meeting_scheduled");
    expect((await db.select().from(leadActivities).where(and(eq(leadActivities.leadId, a), eq(leadActivities.type, "stage_change")))).length).toBe(1);
    for (const stage of ["meeting_done", "booking_in_process", "lost_lead", "future_opportunity"] as const) {
      const b = await leadOf(f.actors.agent1);
      await setStage(b, stage);
      expect((await schedule(f.actors.agent1, b)).movedLead).toBe(false);
      expect((await lead(b)).stage).toBe(stage);
    }
  });

  it("validates fields, organizer scope and lead access", async () => {
    const own = await leadOf(f.actors.agent1);
    const others = await leadOf(f.actors.agent2);
    expect(await fieldOf(schedule(f.actors.agent1, own, { title: "" }))).toBe("title");
    expect(await fieldOf(schedule(f.actors.agent1, own, { startsAt: "" }))).toBe("startsAt");
    expect(await fieldOf(schedule(f.actors.agent1, own, { endsAt: inHours(23) }))).toBe("endsAt");
    expect(await fieldOf(createMeeting(db, f.actors.agent1, { title: "x", type: "virtual", startsAt: inHours(1) }))).toBe("leadId");
    expect(await fieldOf(schedule(f.actors.agent1, others))).toBe("leadId");
    expect(await fieldOf(schedule(f.actors.agent1, own, { organizerId: f.actors.agent2.id }))).toBe("organizerId");
    expect(await errorCode(schedule(f.actors.manager, own, { organizerId: f.actors.agent1.id }))).toBe("ok");
    expect(await fieldOf(schedule(f.actors.manager, own, { organizerId: f.actors.outsideAgent.id }))).toBe("organizerId");
    expect(await fieldOf(schedule(f.actors.superAdmin, own, { organizerId: f.actors.hr.id }))).toBe("organizerId");
    expect(await errorCode(schedule(f.actors.hr, own))).toBe("FORBIDDEN");
  });

  it("scopes visibility: own (organizer or creator), team, all; 404 outside scope; HR denied", async () => {
    const leadId = await leadOf(f.actors.agent1);
    const { meetingId } = await schedule(f.actors.manager, leadId, { organizerId: f.actors.agent1.id });
    await schedule(f.actors.outsideAgent, await leadOf(f.actors.outsideAgent));
    expect(await errorCode(getMeetingDetail(db, f.actors.agent1, meetingId))).toBe("ok");
    expect(await errorCode(getMeetingDetail(db, f.actors.agent2, meetingId))).toBe("NOT_FOUND");
    expect(await errorCode(cancelMeeting(db, f.actors.agent2, meetingId, {}))).toBe("NOT_FOUND");
    expect((await listMeetings(db, f.actors.agent1, {})).total).toBe(1);
    expect((await listMeetings(db, f.actors.manager, {})).total).toBe(1);
    expect((await listMeetings(db, f.actors.superAdmin, {})).total).toBe(2);
    expect(await errorCode(listMeetings(db, f.actors.hr, {}))).toBe("FORBIDDEN");
    expect((await overdueMeetings(db, f.actors.hr)).count).toBe(0);
  });

  it("requires a meeting type from the five options, stores it, filters by it and records a change", async () => {
    const leadId = await leadOf(f.actors.agent1);
    expect(await fieldOf(schedule(f.actors.agent1, leadId, { type: undefined }))).toBe("type");
    expect(await fieldOf(schedule(f.actors.agent1, leadId, { type: "phone" }))).toBe("type");
    for (const type of ["company_office", "site_visit", "virtual", "outdoor", "sales_event"]) {
      const { meetingId } = await schedule(f.actors.agent1, leadId, { type, moveLead: false });
      expect((await meeting(meetingId)).type).toBe(type);
    }
    expect((await listMeetings(db, f.actors.agent1, { type: "virtual" })).rows.map((r) => r.type)).toEqual(["virtual"]);
    expect((await listMeetings(db, f.actors.agent1, {})).total).toBe(5);

    const { meetingId } = await schedule(f.actors.agent1, leadId, { type: "virtual", moveLead: false });
    expect((await updateMeeting(db, f.actors.agent1, meetingId, { type: "outdoor" })).changed).toEqual(["type"]);
    expect((await meeting(meetingId)).type).toBe("outdoor");
    // A meeting saved before the field existed keeps working: edits without a type leave it empty.
    await db.update(meetings).set({ type: null }).where(eq(meetings.id, meetingId));
    expect((await updateMeeting(db, f.actors.agent1, meetingId, { title: "Older meeting" })).changed).toEqual(["title"]);
    expect((await meeting(meetingId)).type).toBeNull();
  });

  it("edits a scheduled meeting with history; completed / cancelled meetings are final", async () => {
    const leadId = await leadOf(f.actors.agent1);
    const { meetingId } = await schedule(f.actors.agent1, leadId);
    expect((await updateMeeting(db, f.actors.agent1, meetingId, { title: "Site visit (moved)", startsAt: inHours(48) })).changed.sort()).toEqual(["startsAt", "title"]);
    expect(await fieldOf(updateMeeting(db, f.actors.agent1, meetingId, { endsAt: inHours(47) }))).toBe("endsAt");
    expect(await history(meetingId)).toEqual(["create", "update"]);
    await cancelMeeting(db, f.actors.agent1, meetingId, { note: "Client travelling" });
    const m = await meeting(meetingId);
    expect(m.status).toBe("cancelled");
    expect(m.cancelledAt).not.toBeNull();
    expect(await errorCode(updateMeeting(db, f.actors.agent1, meetingId, { title: "x" }))).toBe("BUSINESS_RULE");
    expect(await errorCode(completeMeeting(db, f.actors.agent1, meetingId, {}))).toBe("BUSINESS_RULE");
    expect(await errorCode(cancelMeeting(db, f.actors.agent1, meetingId, {}))).toBe("BUSINESS_RULE");
  });

  it("D1: completing moves the lead to Meeting Done forward-only, or not at all when unticked", async () => {
    const a = await leadOf(f.actors.agent1);
    const { meetingId } = await schedule(f.actors.agent1, a);
    expect((await completeMeeting(db, f.actors.agent1, meetingId, { note: "Interested in 2-bed" })).movedLead).toBe(true);
    expect((await lead(a)).stage).toBe("meeting_done");
    expect((await meeting(meetingId)).completedAt).not.toBeNull();
    const acts = await db.select().from(leadActivities).where(and(eq(leadActivities.leadId, a), eq(leadActivities.type, "meeting")));
    expect(acts.map((x) => (x.data as { action: string }).action).sort()).toEqual(["completed", "scheduled"]);

    const b = await leadOf(f.actors.agent1);
    const { meetingId: m2 } = await schedule(f.actors.agent1, b, { moveLead: false });
    expect((await completeMeeting(db, f.actors.agent1, m2, { moveLead: false })).movedLead).toBe(false);
    expect((await lead(b)).stage).toBe("new_lead");

    const c = await leadOf(f.actors.agent1);
    const { meetingId: m3 } = await schedule(f.actors.agent1, c);
    await setStage(c, "booking_in_process");
    expect((await completeMeeting(db, f.actors.agent1, m3, {})).movedLead).toBe(false);
    expect((await lead(c)).stage).toBe("booking_in_process");
  });

  it("two people completing / cancelling at once: exactly one wins", async () => {
    const leadId = await leadOf(f.actors.agent1);
    const { meetingId } = await schedule(f.actors.manager, leadId, { organizerId: f.actors.agent1.id });
    const results = await Promise.allSettled([completeMeeting(db, f.actors.agent1, meetingId, {}), cancelMeeting(db, f.actors.manager, meetingId, {})]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const status = (await meeting(meetingId)).status;
    expect(["completed", "cancelled"]).toContain(status);
    expect((await db.select().from(meetingHistory).where(eq(meetingHistory.meetingId, meetingId))).filter((h) => h.action !== "create")).toHaveLength(1);
  });

  it("lists with search, status / organizer / overdue filters, sort and pagination; lead panel and To-dos", async () => {
    const leadId = await leadOf(f.actors.agent1);
    for (let i = 0; i < 51; i++) await schedule(f.actors.agent1, leadId, { title: `Call ${String(i).padStart(2, "0")}`, moveLead: false });
    const { meetingId: late } = await schedule(f.actors.agent1, leadId, { title: "Zeta overdue", startsAt: inHours(-2), moveLead: false });
    const p1 = await listMeetings(db, f.actors.agent1, { sort: "title", dir: "asc" });
    expect(p1.total).toBe(52);
    expect(p1.rows).toHaveLength(50);
    expect(p1.rows[0].title).toBe("Call 00");
    expect((await listMeetings(db, f.actors.agent1, { sort: "title", dir: "asc", page: "2" })).rows.map((r) => r.title)).toEqual(["Call 50", "Zeta overdue"]);
    expect((await listMeetings(db, f.actors.agent1, { q: "zeta" })).total).toBe(1);
    expect((await listMeetings(db, f.actors.agent1, { overdue: "1" })).rows.map((r) => r.id)).toEqual([late]);
    expect((await listMeetings(db, f.actors.agent1, { organizer: "me", status: "scheduled" })).total).toBe(52);
    expect((await listMeetings(db, f.actors.agent1, { status: "completed" })).total).toBe(0);
    expect((await overdueMeetings(db, f.actors.agent1)).rows.map((r) => r.id)).toEqual([late]);
    await completeMeeting(db, f.actors.agent1, late, { moveLead: false });
    expect((await overdueMeetings(db, f.actors.agent1)).count).toBe(0);
    expect((await meetingsForLead(db, f.actors.agent1, leadId)).length).toBe(50);
  });

  it("admin sees all and can pick any organizer; form options follow scope", async () => {
    const [u] = await db.insert(users).values({ name: "Admin", email: "admin@test.local", role: "admin", passwordHash: "x" }).returning();
    const admin = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    const leadId = await leadOf(f.actors.outsideAgent);
    expect(await errorCode(schedule(admin, leadId, { organizerId: f.actors.outsideAgent.id }))).toBe("ok");
    expect((await listMeetings(db, admin, {})).total).toBe(1);
    expect((await meetingFormOptions(db, f.actors.agent1, f.projectId)).organizers.map((o) => o.id)).toEqual([f.actors.agent1.id]);
    expect((await meetingFormOptions(db, f.actors.manager, f.projectId)).organizers.map((o) => o.id).sort()).toEqual([f.actors.manager.id, f.actors.agent1.id, f.actors.agent2.id].sort());
  });

  it("database constraints back the rules", async () => {
    const leadId = await leadOf(f.actors.agent1);
    const { meetingId } = await schedule(f.actors.agent1, leadId);
    await expect(db.update(meetings).set({ status: "completed" }).where(eq(meetings.id, meetingId))).rejects.toThrow();
    await expect(db.update(meetings).set({ endsAt: new Date(0) }).where(eq(meetings.id, meetingId))).rejects.toThrow();
    await expect(db.update(meetings).set({ title: "  " }).where(eq(meetings.id, meetingId))).rejects.toThrow();
    await expect(db.delete(leads).where(eq(leads.id, leadId))).rejects.toThrow();
  });
});
