import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listAuditLogs } from "@/modules/audit/service";
import { cancelBooking, createBooking } from "@/modules/bookings/commands";
import { createUnit } from "@/modules/inventory/commands";
import { cancelFollowUp, completeFollowUp, createLead, rescheduleFollowUp, scheduleFollowUp } from "@/modules/leads/commands";
import { logCallUpdate } from "@/modules/leads/call-update";
import { markMissedFollowUps } from "@/modules/leads/missed-follow-ups";
import { getLeadDetail } from "@/modules/leads/queries";
import { createMeeting, updateMeeting } from "@/modules/meetings/commands";
import { auditLogs, followUps, leadActivities, leads } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

describe.skipIf(!hasTestDb)("Lead audit trail (client, 24 Nov 2026; PostgreSQL)", () => {
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
  const newLead = async (overrides = {}) => {
    const r = await createLead(db, f.actors.superAdmin, leadInput(f, { ownerId: f.actors.agent1.id, ...overrides }));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };
  const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e as AppError).code);
  const types = async (id: string) => (await db.select().from(leadActivities).where(eq(leadActivities.leadId, id))).map((a) => a.type);

  it("reschedules and cancels follow-ups, keeping the old time and the reason", async () => {
    const id = await newLead();
    const a = f.actors.agent1;
    const { id: fu } = await scheduleFollowUp(db, a, id, { dueAt: inDays(1), note: "Call back" });
    expect(await code(rescheduleFollowUp(db, f.actors.agent2, fu, { dueAt: inDays(2) }))).toBe("NOT_FOUND");
    expect(await code(rescheduleFollowUp(db, a, fu, { dueAt: inDays(-1) }))).toBe("VALIDATION_FAILED");
    const to = inDays(2);
    await rescheduleFollowUp(db, a, fu, { dueAt: to, reason: "Customer busy" });
    expect((await db.select().from(leads).where(eq(leads.id, id)))[0].nextFollowUpAt?.toISOString()).toBe(to);
    expect(await code(cancelFollowUp(db, a, fu, { reason: "" }))).toBe("VALIDATION_FAILED");
    await cancelFollowUp(db, a, fu, { reason: "No longer needed" });
    expect(await code(cancelFollowUp(db, a, fu, { reason: "again" }))).toBe("BUSINESS_RULE");
    expect((await db.select().from(leads).where(eq(leads.id, id)))[0].nextFollowUpAt).toBeNull();
    const t = await types(id);
    expect(t).toContain("follow_up_rescheduled");
    expect(t).toContain("follow_up_cancelled");
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "lead.follow_up_reschedule"));
    expect(log).toMatchObject({ actorId: a.id, after: { dueAt: to, reason: "Customer busy" } });
  });

  it("records a follow-up as missed once, after its due day, and again only for a new due date", async () => {
    const id = await newLead();
    const { id: fu } = await scheduleFollowUp(db, f.actors.agent1, id, { dueAt: inDays(1) });
    const today = new Date();
    await db.update(followUps).set({ dueAt: today }).where(eq(followUps.id, fu));
    expect((await markMissedFollowUps(db, today)).marked).toBe(0);
    const tomorrow = new Date(today.getTime() + DAY);
    expect((await markMissedFollowUps(db, tomorrow)).marked).toBe(1);
    expect((await markMissedFollowUps(db, tomorrow)).marked).toBe(0);
    expect((await db.select().from(followUps).where(eq(followUps.id, fu)))[0].status).toBe("pending");
    await rescheduleFollowUp(db, f.actors.agent1, fu, { dueAt: inDays(3) });
    // Done late without the job having run: the miss is recorded first.
    await db.update(followUps).set({ dueAt: new Date(Date.now() - 2 * DAY) }).where(eq(followUps.id, fu));
    await completeFollowUp(db, f.actors.agent1, fu);
    expect((await types(id)).filter((t) => t === "follow_up_missed")).toHaveLength(2);
  });

  it("shows booking and meeting changes on the lead's timeline, once each", async () => {
    const id = await newLead();
    const a = f.actors.agent1;
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "A-1", areaSqft: "500", basePrice: "10000000" });
    const { bookingId } = await createBooking(db, a, { projectId: f.projectId, leadId: id, unitId, tokenAmount: "500000" });
    await cancelBooking(db, f.actors.superAdmin, bookingId, { reason: "Changed their mind" });
    expect((await db.select().from(leads).where(eq(leads.id, id)))[0].stage).toBe("new_lead");
    const { meetingId } = await createMeeting(db, a, { title: "Visit", type: "site_visit", startsAt: inDays(1), leadId: id });
    await updateMeeting(db, a, meetingId, { location: "Head office" });
    await logCallUpdate(db, a, id, { result: "no_call", meetingResult: { meetingId, outcome: "rescheduled", startsAt: inDays(2) } });
    const { activities } = await getLeadDetail(db, a, id);
    const changes = activities.filter((x) => x.type === "record_change").map((x) => (x.data as { action: string }).action);
    expect(changes.sort()).toEqual(["booking.cancel", "booking.create", "meeting.update"]);
    expect(activities.filter((x) => (x.data as { action?: string } | null)?.action === "rescheduled")).toHaveLength(1);
    expect(activities.every((x, i) => i === 0 || x.createdAt <= activities[i - 1].createdAt)).toBe(true);
  });

  it("filters the audit log by lead, with its bookings and meetings, by code, name or phone", async () => {
    const id = await newLead({ name: "Audit Customer" });
    const other = await newLead({ name: "Someone Else" });
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "A-1", areaSqft: "500", basePrice: "10000000" });
    await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: id, unitId, tokenAmount: "500000" });
    await createMeeting(db, f.actors.agent1, { title: "Visit", type: "site_visit", startsAt: inDays(1), leadId: id });
    await createMeeting(db, f.actors.agent1, { title: "Other", type: "site_visit", startsAt: inDays(1), leadId: other });
    const [lead] = await db.select().from(leads).where(eq(leads.id, id));
    for (const term of [lead.code.toLowerCase(), "audit cust", lead.phoneE164]) {
      const r = await listAuditLogs(db, f.actors.superAdmin, { lead: term });
      expect(r.leadMatches?.map((l) => l.id)).toEqual([id]);
      expect([...new Set(r.rows.map((x) => x.entity))].sort()).toEqual(["booking", "lead", "meeting"]);
      expect(r.rows.some((x) => x.entityId === other)).toBe(false);
    }
    const byAgent = await listAuditLogs(db, f.actors.superAdmin, { lead: lead.code, actor: f.actors.agent1.id });
    expect(byAgent.rows.every((x) => x.actorId === f.actors.agent1.id)).toBe(true);
    expect(await listAuditLogs(db, f.actors.superAdmin, { lead: "nobody at all" })).toMatchObject({ total: 0, leadMatches: [] });
    expect(await code(listAuditLogs(db, f.actors.agent1, { lead: lead.code }))).toBe("FORBIDDEN");
  });

  it("the database refuses to change or delete history", async () => {
    const id = await newLead();
    const refused = async (q: ReturnType<typeof sql>) => {
      const e = (await db.execute(q).then(() => null, (x: unknown) => x)) as { cause?: { message: string }; message: string } | null;
      expect(e?.cause?.message ?? e?.message).toContain("append-only");
    };
    await refused(sql`update audit_logs set action = 'x' where entity_id = ${id}`);
    await refused(sql`delete from audit_logs where entity_id = ${id}`);
    await refused(sql`update lead_activities set body = 'x' where lead_id = ${id}`);
    await refused(sql`delete from lead_activities where lead_id = ${id}`);
    // Pinning an entry on someone else is a change too.
    await refused(sql`update audit_logs set actor_id = ${f.actors.agent2.id} where entity_id = ${id}`);
  });
});
