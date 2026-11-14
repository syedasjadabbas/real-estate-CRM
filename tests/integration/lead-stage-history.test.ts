import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, cancelBooking, createBooking } from "@/modules/bookings/commands";
import { createUnit } from "@/modules/inventory/commands";
import { changeStage, createLead, decideLostRequest, markLost } from "@/modules/leads/commands";
import { STAGE_LABELS } from "@/modules/leads/constants";
import { getLeadDetail } from "@/modules/leads/queries";
import { completeMeeting, createMeeting } from "@/modules/meetings/commands";
import { approvals, auditLogs, leadActivities, leads, lostReasons } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
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

describe.skipIf(!hasTestDb)("FR-021: every stage change is on the timeline as from → to (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let unitCounter = 0;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
  });

  const newLead = async (owner: Actor = f.actors.agent1) => {
    const r = await createLead(db, f.actors.superAdmin, leadInput(f, { ownerId: owner.id }));
    if (r.outcome !== "created") throw new Error("lead");
    return r.leadId;
  };
  const moves = async (leadId: string) =>
    (await db.select().from(leadActivities).where(and(eq(leadActivities.leadId, leadId), eq(leadActivities.type, "stage_change"))).orderBy(desc(leadActivities.createdAt))).map((a) => a.data as Record<string, unknown>);
  const stageOf = async (leadId: string) => (await db.select({ stage: leads.stage }).from(leads).where(eq(leads.id, leadId)))[0].stage;
  /** An agent's pending lost request on a lead at `stage`. */
  const pendingRequest = async (stage?: "contacted") => {
    const leadId = await newLead();
    if (stage) await changeStage(db, f.actors.agent1, leadId, { stage });
    expect(await markLost(db, f.actors.agent1, leadId, { lostReasonId: f.lostReasonId, note: "No budget" })).toEqual({ status: "pending_approval" });
    const [request] = await db.select({ id: approvals.id }).from(approvals).where(eq(approvals.leadId, leadId));
    return { leadId, approvalId: request.id };
  };
  const reasonName = async () => (await db.select({ name: lostReasons.name }).from(lostReasons).where(eq(lostReasons.id, f.lostReasonId)))[0].name;

  it("an approved lost request records the move, with its reason, like a direct Lost does", async () => {
    const { leadId, approvalId } = await pendingRequest("contacted");
    await decideLostRequest(db, f.actors.manager, approvalId, { approve: true, comment: "Agreed" });
    expect(await stageOf(leadId)).toBe("lost_lead");
    const [move] = await moves(leadId);
    expect(move).toEqual({ from: "contacted", to: "lost_lead", fromLabel: STAGE_LABELS.contacted, toLabel: STAGE_LABELS.lost_lead, reason: await reasonName() });

    const direct = await newLead();
    await changeStage(db, f.actors.manager, direct, { stage: "contacted" });
    await markLost(db, f.actors.manager, direct, { lostReasonId: f.lostReasonId });
    expect((await moves(direct))[0]).toEqual(move);
  });

  it("the decision entry stays, with its comment, and the entry is the manager's", async () => {
    const { leadId, approvalId } = await pendingRequest();
    await decideLostRequest(db, f.actors.manager, approvalId, { approve: true, comment: "Agreed" });
    const entries = await db.select().from(leadActivities).where(eq(leadActivities.leadId, leadId));
    expect(entries.filter((a) => a.type === "lost_decided")).toEqual([expect.objectContaining({ actorId: f.actors.manager.id, body: "Agreed", data: { approved: true, from: "new_lead" } })]);
    expect(entries.filter((a) => a.type === "stage_change")).toEqual([expect.objectContaining({ actorId: f.actors.manager.id })]);
    const { activities } = await getLeadDetail(db, f.actors.manager, leadId);
    expect(activities.map((a) => a.type)).toEqual(expect.arrayContaining(["stage_change", "lost_decided", "lost_requested"]));
  });

  it("the audit row shows the stage before and after", async () => {
    const { leadId, approvalId } = await pendingRequest();
    await decideLostRequest(db, f.actors.manager, approvalId, { approve: true });
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "lead.lost_approved"), eq(auditLogs.entityId, leadId)));
    expect(audit).toMatchObject({ before: { stage: "new_lead" }, after: { approvalId, stage: "lost_lead" } });
  });

  it("a rejected request moves nothing and records no move", async () => {
    const { leadId, approvalId } = await pendingRequest();
    await decideLostRequest(db, f.actors.manager, approvalId, { approve: false, comment: "Try again" });
    expect(await stageOf(leadId)).toBe("new_lead");
    expect(await moves(leadId)).toEqual([]);
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "lead.lost_rejected"), eq(auditLogs.entityId, leadId)));
    expect(audit).toMatchObject({ before: { stage: "new_lead" }, after: { approvalId, stage: "new_lead" } });
  });

  it("approving when the lead is already Lost or Booked moves nothing and records no move", async () => {
    const lost = await pendingRequest();
    await markLost(db, f.actors.manager, lost.leadId, { lostReasonId: f.lostReasonId });
    expect(await moves(lost.leadId)).toHaveLength(1);
    await decideLostRequest(db, f.actors.manager, lost.approvalId, { approve: true });
    expect(await moves(lost.leadId)).toHaveLength(1);

    const booked = await pendingRequest();
    await db.update(leads).set({ stage: "booked" }).where(eq(leads.id, booked.leadId));
    await decideLostRequest(db, f.actors.manager, booked.approvalId, { approve: true });
    expect(await stageOf(booked.leadId)).toBe("booked");
    expect(await moves(booked.leadId)).toEqual([]);
  });

  it("a refused decision records nothing: open booking, repeat decision, wrong role, wrong team", async () => {
    const { leadId, approvalId } = await pendingRequest();
    unitCounter += 1;
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: `H-${unitCounter}`, areaSqft: "500", basePrice: "1000000" });
    const { bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId, unitId, ratePerSqft: "2000", tokenAmount: "20000" });
    const before = await moves(leadId);
    expect(await errorCode(decideLostRequest(db, f.actors.manager, approvalId, { approve: true }))).toBe("BUSINESS_RULE");
    expect(await moves(leadId)).toEqual(before);

    expect(await errorCode(decideLostRequest(db, f.actors.agent1, approvalId, { approve: true }))).toBe("FORBIDDEN");
    await cancelBooking(db, f.actors.manager, bookingId, { reason: "Buyer withdrew" });
    await decideLostRequest(db, f.actors.manager, approvalId, { approve: false });
    const after = await moves(leadId);
    expect(await errorCode(decideLostRequest(db, f.actors.manager, approvalId, { approve: true }))).toBe("BUSINESS_RULE");
    expect(await moves(leadId)).toEqual(after);
  });

  it("two simultaneous approvals record one move", async () => {
    const { leadId, approvalId } = await pendingRequest();
    const results = await Promise.allSettled([decideLostRequest(db, f.actors.manager, approvalId, { approve: true }), decideLostRequest(db, f.actors.superAdmin, approvalId, { approve: true })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await moves(leadId)).toHaveLength(1);
  });

  it("every other way a stage changes still records from → to", async () => {
    const leadId = await newLead();
    await changeStage(db, f.actors.agent1, leadId, { stage: "contacted" });
    expect((await moves(leadId))[0]).toMatchObject({ from: "new_lead", to: "contacted" });

    const { meetingId } = await createMeeting(db, f.actors.agent1, { title: "Site visit", type: "site_visit", leadId, startsAt: new Date(Date.now() + 3_600_000), moveLead: false });
    await completeMeeting(db, f.actors.agent1, meetingId, { moveLead: true });
    expect((await moves(leadId))[0]).toMatchObject({ from: "contacted", to: "meeting_done" });

    unitCounter += 1;
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: `H-${unitCounter}`, areaSqft: "500", basePrice: "1000000" });
    const { bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId, unitId, ratePerSqft: "2000", tokenAmount: "20000" });
    expect((await moves(leadId))[0]).toMatchObject({ from: "meeting_done", to: "booking_in_process" });
    for (const toStage of ["down_payment", "agreement_pending", "confirmed"]) await advanceBooking(db, f.actors.manager, bookingId, { toStage });
    expect((await moves(leadId))[0]).toMatchObject({ from: "booking_in_process", to: "booked" });
    expect(await moves(leadId)).toHaveLength(4);
  });
});
