import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, createBooking } from "@/modules/bookings/commands";
import { getBookingDetail } from "@/modules/bookings/queries";
import { dashboardData } from "@/modules/dashboard/queries";
import { listDocuments, openDocument, uploadDocument } from "@/modules/documents/service";
import { decideReversal, recordPayment, requestReversal } from "@/modules/finance/commands";
import { listPaymentMethods } from "@/modules/finance/queries";
import { collectionsByProject, exportReport, outstandingBy } from "@/modules/finance/reports";
import { outstandingBookings } from "@/modules/finance/views";
import { createUnit } from "@/modules/inventory/commands";
import { changeStage, createLead, decideLostRequest, markLost, scheduleFollowUp } from "@/modules/leads/commands";
import { getLeadDetail, listLeads } from "@/modules/leads/queries";
import { listNotifications, markAllRead, markRead, updateReminderMinutes } from "@/modules/notifications/service";
import { listRecordings, openRecording, uploadRecording } from "@/modules/recordings/service";
import { approvals, auditLogs, bookingPayments, notifications, users } from "@/server/db/schema";
import { loadActor } from "@/server/auth/session-store";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { readObject } from "@/server/storage/local";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

/**
 * End-to-end business workflows on the test database: each test chains the real services the
 * screens and APIs call, and checks every side effect (notifications, timeline, audit, files,
 * dashboard and finance totals) along the way.
 */
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};
const mp3 = () => {
  const b = new Uint8Array(4096);
  b.set([0x49, 0x44, 0x33, 4, 0, 0]);
  b[4000] = 9;
  return b;
};
const pdf = () => new TextEncoder().encode("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const bytesOf = async (s: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(s).arrayBuffer());
const today = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);

describe.skipIf(!hasTestDb)("End-to-end workflows (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;
  let accountant: Actor;
  let storageDir: string;

  beforeAll(async () => {
    ({ db, close } = connectTestDb());
    storageDir = await mkdtemp(path.join(tmpdir(), "mz-workflows-"));
    process.env.FILE_STORAGE_DIR = storageDir;
  });
  afterAll(async () => {
    await close();
    delete process.env.FILE_STORAGE_DIR;
    await rm(storageDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const mk = async (role: "admin" | "accountant", name: string, email: string) => {
      const [u] = await db.insert(users).values({ name, email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    admin = await mk("admin", "Ada Admin", "admin@test.local");
    accountant = await mk("accountant", "Accountant", "acc@test.local");
  });

  const inbox = async (actor: Actor) => listNotifications(db, actor);

  it("sales workflow: assignment → follow-up reminder → stage change → call recording and document → re-inquiry → lost request rejected", async () => {
    // 1. Manager creates a lead for agent1: agent1 is notified, the manager is not.
    const created = await createLead(db, f.actors.manager, leadInput(f, { name: "Workflow Lead", phoneNumber: "03001112233", ownerId: f.actors.agent1.id }));
    if (created.outcome !== "created") throw new Error("setup");
    const leadId = created.leadId;
    expect((await inbox(f.actors.agent1)).rows.map((n) => n.type)).toEqual(["lead_assigned"]);
    expect((await inbox(f.actors.manager)).total).toBe(0);

    // 2. Admin turns reminders on; agent1 schedules a follow-up in 20 minutes and gets one reminder however often the bell polls.
    await updateReminderMinutes(db, admin, { minutes: "30" });
    await scheduleFollowUp(db, f.actors.agent1, leadId, { dueAt: new Date(Date.now() + 20 * 60_000), note: "Call back about pricing" });
    for (let i = 0; i < 3; i++) await inbox(f.actors.agent1);
    const afterReminder = await inbox(f.actors.agent1);
    expect(afterReminder.rows.filter((n) => n.type === "follow_up_soon")).toHaveLength(1);
    expect(afterReminder.unread).toBe(2);

    // 3. Stage change: timeline entry and audit row with before/after.
    await changeStage(db, f.actors.agent1, leadId, { stage: "contacted" });
    const [stageAudit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "lead.stage"), eq(auditLogs.entityId, leadId)));
    expect([stageAudit.actorId, stageAudit.before, stageAudit.after]).toEqual([f.actors.agent1.id, { stage: "new_lead" }, { stage: "contacted" }]);
    const detail = await getLeadDetail(db, f.actors.agent1, leadId);
    expect(detail.activities.find((a) => a.type === "stage_change")?.data).toMatchObject({ from: "new_lead", to: "contacted" });

    // 4. Agent uploads a call recording and a document; the manager can play / download both, other users cannot.
    const rec = await uploadRecording(db, f.actors.agent1, leadId, { bytes: mp3(), name: "call 1.mp3", durationSec: "61" });
    const doc = await uploadDocument(db, f.actors.agent1, leadId, { bytes: pdf(), name: "brochure.pdf" });
    const recFile = await openRecording(db, f.actors.manager, rec.id);
    expect(await bytesOf(readObject(recFile.storageKey))).toEqual(mp3());
    expect([...(await bytesOf(readObject(recFile.storageKey, { start: 3999, end: 4001 })))]).toEqual([0, 9, 0]);
    const docFile = await openDocument(db, f.actors.manager, doc.id);
    expect(new TextDecoder().decode(await bytesOf(readObject(docFile.storageKey)))).toContain("%PDF-1.7");
    expect(await code(openRecording(db, f.actors.agent2, rec.id))).toBe("NOT_FOUND");
    expect(await code(openDocument(db, f.actors.outsideAgent, doc.id))).toBe("NOT_FOUND");
    expect(await code(openRecording(db, f.actors.hr, rec.id))).toBe("FORBIDDEN");
    expect(await code(openDocument(db, accountant, doc.id))).toBe("FORBIDDEN");
    expect((await listRecordings(db, f.actors.superAdmin, leadId)).map((r) => [r.name, r.durationSec])).toEqual([["call 1.mp3", 61]]);
    expect((await listDocuments(db, admin, leadId)).map((d) => d.name)).toEqual(["brochure.pdf"]);
    const uploads = (await getLeadDetail(db, f.actors.agent1, leadId)).activities.filter((a) => a.type === "file_uploaded");
    expect(uploads.map((a) => (a.data as { kind: string }).kind).sort()).toEqual(["call_recording", "document"]);

    // 5. Re-inquiry by an admin: the owner is notified once.
    await createLead(db, admin, leadInput(f, { phoneNumber: "03001112233", onDuplicate: "regenerate" }));
    expect((await inbox(f.actors.agent1)).rows.filter((n) => n.type === "lead_regenerated")).toHaveLength(1);

    // 6. Agent requests Lost → the team manager is notified; the manager rejects → the agent is notified; the stage stays.
    await markLost(db, f.actors.agent1, leadId, { lostReasonId: f.lostReasonId, note: "Budget" });
    const managerInbox = await inbox(f.actors.manager);
    expect(managerInbox.rows.map((n) => [n.type, n.link])).toEqual([["lost_requested", `/dashboard/leads/${leadId}`]]);
    const [request] = await db.select().from(approvals).where(eq(approvals.leadId, leadId));
    await decideLostRequest(db, f.actors.manager, request.id, { approve: false, comment: "Try one more call" });
    const final = await inbox(f.actors.agent1);
    expect(final.rows.map((n) => n.type)).toEqual(["lost_rejected", "lead_regenerated", "follow_up_soon", "lead_assigned"]);
    expect((await getLeadDetail(db, f.actors.agent1, leadId)).lead.stage).toBe("contacted");
    // Nobody received a notification for their own action, and no event was stored twice.
    const all = await db.select().from(notifications);
    expect(new Set(all.map((n) => `${n.userId}|${n.dedupeKey}`)).size).toBe(all.length);
    expect(all.filter((n) => n.userId === f.actors.manager.id).map((n) => n.type)).toEqual(["lost_requested"]);

    // 7. Read state: mark one, then all; other users' counts are untouched.
    expect(final.unread).toBe(4);
    await markRead(db, f.actors.agent1, final.rows[0].id);
    expect((await inbox(f.actors.agent1)).unread).toBe(3);
    expect(await markAllRead(db, f.actors.agent1)).toEqual({ marked: 3 });
    expect((await inbox(f.actors.agent1)).unread).toBe(0);
    expect((await inbox(f.actors.manager)).unread).toBe(1);
    expect(await code(markRead(db, f.actors.agent1, managerInbox.rows[0].id))).toBe("NOT_FOUND");
  });

  it("dashboard reconciles with the leads lists for every scope", async () => {
    const mk = async (owner: Actor, set: { stage?: "booked" | "lost_lead"; reason?: boolean } = {}) => {
      const r = await createLead(db, f.actors.superAdmin, leadInput(f, { ownerId: owner.id }));
      if (r.outcome !== "created") throw new Error("setup");
      if (set.stage === "lost_lead") {
        await markLost(db, f.actors.superAdmin, r.leadId, { lostReasonId: f.lostReasonId });
      } else if (set.stage) await changeStage(db, f.actors.superAdmin, r.leadId, { stage: "booking_in_process" });
      return r.leadId;
    };
    await mk(f.actors.agent1);
    await mk(f.actors.agent1, { stage: "lost_lead" });
    await mk(f.actors.agent2, { stage: "lost_lead" });
    await mk(f.actors.agent2, { stage: "booked" });
    await mk(f.actors.outsideAgent);
    const day = today();
    for (const actor of [f.actors.superAdmin, admin, f.actors.manager, f.actors.agent1, f.actors.agent2, f.actors.outsideAgent]) {
      const dash = (await dashboardData(db, actor, f.projectId, { range: "custom", from: day, to: day }, new Date())).data!;
      const all = await listLeads(db, actor, f.projectId, { from: day, to: day });
      const lost = await listLeads(db, actor, f.projectId, { view: "lost", from: day, to: day });
      expect(dash.kpis!.totalLeads).toBe(all.total);
      expect(dash.kpis!.lost).toBe(lost.total);
      expect(dash.lost!.total).toBe(lost.total);
      expect(dash.lost!.byReason.reduce((n, r) => n + r.count, 0)).toBe(lost.total);
      const reasonRow = dash.lost!.byReason.find((r) => r.id === f.lostReasonId);
      if (reasonRow) expect((await listLeads(db, actor, f.projectId, { view: "lost", lostReason: f.lostReasonId, from: day, to: day })).total).toBe(reasonRow.count);
    }
    // HR and accountants get no lead analytics.
    expect((await dashboardData(db, f.actors.hr, f.projectId, {}, new Date())).data).toBeNull();
    expect((await dashboardData(db, accountant, f.projectId, {}, new Date())).data).toBeNull();
  });

  it("finance workflow: booking → payments → reversal → booking Paid, collections, outstanding and audited exports agree", async () => {
    const cashId = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash")!.id;
    const lead = await createLead(db, f.actors.agent1, leadInput(f));
    if (lead.outcome !== "created") throw new Error("setup");
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "WF-1", areaSqft: "500", basePrice: "1" });
    const { bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: lead.leadId, unitId, ratePerSqft: "25000", tokenAmount: "500000" });
    await advanceBooking(db, f.actors.superAdmin, bookingId, { toStage: "token_pending" });
    const day = today();
    await recordPayment(db, accountant, { bookingId, type: "token", amount: "500000", receivedOn: day, methodId: cashId });
    const second = await recordPayment(db, accountant, { bookingId, type: "down_payment", amount: "1000000", receivedOn: day, methodId: cashId });
    const { requestId } = await requestReversal(db, accountant, second.paymentId, { reason: "Cheque bounced at the bank" });
    await decideReversal(db, f.actors.manager, requestId, { approve: true, note: "Confirmed with bank" });

    const ledger = await db.select().from(bookingPayments).where(eq(bookingPayments.bookingId, bookingId));
    const net = ledger.reduce((n, r) => n + (r.kind === "payment" ? r.amount : -r.amount), 0);
    expect(net).toBe(500_000);
    const booking = await getBookingDetail(db, f.actors.superAdmin, bookingId, day);
    expect(booking.money).toMatchObject({ paid: 500_000, total: 12_500_000, outstanding: 12_000_000 });

    const reversalDay = ledger.find((r) => r.kind !== "payment")!.receivedOn;
    const range = { from: day < reversalDay ? day : reversalDay, to: day > reversalDay ? day : reversalDay };
    const collections = await collectionsByProject(db, accountant, range);
    expect(collections.totals).toMatchObject({ received: 1_500_000, reversed: 1_000_000, net: 500_000, receipts: 2, reversals: 1 });
    const screen = await outstandingBookings(db, accountant, {});
    const byProject = await outstandingBy(db, admin, "project");
    expect(byProject.totals.outstanding).toBe(screen.totals.outstanding);
    expect(byProject.rows[0]).toMatchObject({ label: "Test Project", outstanding: booking.money.outstanding });

    const before = (await db.select().from(auditLogs).where(eq(auditLogs.action, "finance.report_export"))).length;
    const csv = await exportReport(db, accountant, { report: "collections", ...range });
    expect(csv.body).toContain("Total,");
    expect(csv.body).toContain(",1500000,1,1000000,500000");
    await exportReport(db, f.actors.superAdmin, { report: "outstanding_agent" });
    const exports = await db.select().from(auditLogs).where(eq(auditLogs.action, "finance.report_export"));
    expect(exports.length).toBe(before + 2);
    expect(exports.at(-2)?.after).toMatchObject({ totals: { net: 500_000 } });
    // Payment and reversal audits exist for the ledger rows.
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "payment.record"))).length).toBe(2);
    expect(await code(exportReport(db, f.actors.manager, { report: "collections" }))).toBe("FORBIDDEN");
  });
});
