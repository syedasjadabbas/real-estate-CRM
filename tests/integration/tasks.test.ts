import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "@/modules/bookings/commands";
import { createUnit, updateUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { createTask, rebuildInstallments, setTaskStatus, updateTask } from "@/modules/tasks/commands";
import { getTaskDetail, listTasks, overdueTasks, taskFormOptions } from "@/modules/tasks/queries";
import { getProposalSettings, updateProposalSettings } from "@/modules/tasks/settings";
import { loadActor } from "@/server/auth/session-store";
import { appSettings, auditLogs, bookingPayments, taskHistory, taskInstallmentRows, tasks, units, users } from "@/server/db/schema";
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

describe.skipIf(!hasTestDb)("Tasks module (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let unitId: string;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    // Same seed rows as migration 0006 (resetDb truncates app_settings).
    await db.insert(appSettings).values([
      { key: "proposal.agent_discount_cap_pct", value: "5" },
      { key: "proposal.down_payment_pct", value: "30" },
      { key: "proposal.installment_count", value: "36" },
    ]);
    unitId = (await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "A-101", areaSqft: "500", basePrice: "10000000" })).unitId;
  });

  const leadOf = async (owner: Actor) => {
    const r = await createLead(db, owner, leadInput(f));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };
  const general = (actor: Actor, extra: Record<string, unknown> = {}) => createTask(db, actor, { title: "Call back", type: "general", ...extra });
  const proposal = (actor: Actor, p: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    createTask(db, actor, { title: "Plan for Ali", type: "proposal", proposal: { customerName: "Ali", projectId: f.projectId, unitId, firstInstallmentMonth: "2027-01", ...p }, ...extra });
  const rowsOf = async (taskId: string) => db.select().from(taskInstallmentRows).where(eq(taskInstallmentRows.taskId, taskId)).orderBy(taskInstallmentRows.seq);
  const taskRow = async (taskId: string) => (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0];

  it("creates a task assigned to the creator by default, with history and audit", async () => {
    const { taskId } = await general(f.actors.agent1, { dueAt: "2026-11-01T10:00:00+05:00", description: "Ask about budget" });
    const t = await taskRow(taskId);
    expect(t).toMatchObject({ assigneeId: f.actors.agent1.id, createdById: f.actors.agent1.id, status: "open", proposal: null });
    expect(t.dueAt?.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect((await db.select().from(taskHistory).where(eq(taskHistory.taskId, taskId))).map((h) => h.action)).toEqual(["create"]);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.entityId, taskId)))[0].action).toBe("task.create");
  });

  it("enforces roles: HR can't create tasks; agents assign only to themselves; managers to their team", async () => {
    expect(await errorCode(general(f.actors.hr))).toBe("FORBIDDEN");
    expect((await listTasks(db, f.actors.hr, {})).rows).toEqual([]);
    expect(await fieldOf(general(f.actors.agent1, { assigneeId: f.actors.agent2.id }))).toBe("assigneeId");
    expect(await errorCode(general(f.actors.manager, { assigneeId: f.actors.agent1.id }))).toBe("ok");
    expect(await fieldOf(general(f.actors.manager, { assigneeId: f.actors.outsideAgent.id }))).toBe("assigneeId");
    expect(await errorCode(general(f.actors.superAdmin, { assigneeId: f.actors.outsideAgent.id }))).toBe("ok");
    // Q45: Admins assign to all users, HR included.
    expect(await fieldOf(general(f.actors.superAdmin, { assigneeId: f.actors.hr.id }))).toBeNull();
  });

  it("scopes visibility: own for agents, team for managers, all for admins (404 outside scope)", async () => {
    const { taskId } = await general(f.actors.manager, { assigneeId: f.actors.agent1.id });
    await general(f.actors.outsideAgent);
    expect(await errorCode(getTaskDetail(db, f.actors.agent1, taskId))).toBe("ok");
    expect(await errorCode(getTaskDetail(db, f.actors.agent2, taskId))).toBe("NOT_FOUND");
    expect(await errorCode(setTaskStatus(db, f.actors.agent2, taskId, { status: "done" }))).toBe("NOT_FOUND");
    expect((await listTasks(db, f.actors.agent1, {})).total).toBe(1);
    expect((await listTasks(db, f.actors.manager, {})).total).toBe(1);
    expect((await listTasks(db, f.actors.outsideAgent, {})).total).toBe(1);
    expect((await listTasks(db, f.actors.superAdmin, {})).total).toBe(2);
  });

  it("only links leads and bookings the actor can access, and a booking must match the lead", async () => {
    const own = await leadOf(f.actors.agent1);
    const others = await leadOf(f.actors.agent2);
    expect(await fieldOf(general(f.actors.agent1, { leadId: others }))).toBe("leadId");
    const { bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: own, unitId, ratePerSqft: "20000", tokenAmount: "500000" });
    expect(await errorCode(general(f.actors.agent1, { leadId: own, bookingId }))).toBe("ok");
    expect(await fieldOf(general(f.actors.agent2, { bookingId }))).toBe("bookingId");
    expect(await fieldOf(general(f.actors.manager, { leadId: others, bookingId }))).toBe("bookingId");
    // An agent with a task on a lead they can't open sees the task but not the lead's name.
    const { taskId } = await general(f.actors.manager, { assigneeId: f.actors.agent1.id, leadId: others });
    const detail = await getTaskDetail(db, f.actors.agent1, taskId);
    expect(detail.lead).toBeNull();
    expect(detail.hiddenLead).toBe(true);
    expect((await listTasks(db, f.actors.agent1, {})).rows.find((r) => r.id === taskId)?.leadName).toBeNull();
  });

  it("builds a proposal from the unit: total = area × rate, N+1 rows adding up to the discounted value", async () => {
    const { taskId } = await proposal(f.actors.agent1, { discountPct: "5" });
    const t = await taskRow(taskId);
    expect(t.proposal).toMatchObject({ areaSqft: 500, pricePerSqft: 20_000, totalList: 10_000_000, discountPct: 5, afterDiscount: 9_500_000, downPaymentPct: 30, downPayment: 2_850_000, installmentCount: 36, apartmentNo: "A-101" });
    const rows = await rowsOf(taskId);
    expect(rows).toHaveLength(37);
    expect(rows.reduce((s, r) => s + Math.round(r.amount * 100), 0)).toBe(950_000_000);
    expect(await fieldOf(createTask(db, f.actors.agent1, { title: "x", type: "proposal" }))).toBe("proposal.customerName");
  });

  it("rejects an agent discount above the cap; managers use their own cap or the agent cap; admins any", async () => {
    expect(await fieldOf(proposal(f.actors.agent1, { discountPct: "5.01" }))).toBe("proposal.discountPct");
    expect(await errorCode(proposal(f.actors.agent1, { discountPct: "5" }))).toBe("ok");
    expect(await fieldOf(proposal(f.actors.manager, { discountPct: "8" }))).toBe("proposal.discountPct");
    await updateProposalSettings(db, f.actors.superAdmin, { managerCap: "10" });
    expect(await errorCode(proposal(f.actors.manager, { discountPct: "8" }))).toBe("ok");
    expect(await errorCode(proposal(f.actors.superAdmin, { discountPct: "20" }))).toBe("ok");
  });

  it("locks the down payment for agents and keeps the saved plan when settings change later", async () => {
    expect(await fieldOf(proposal(f.actors.agent1, { downPaymentPct: "20" }))).toBe("proposal.downPaymentPct");
    const { taskId } = await proposal(f.actors.agent1);
    await updateProposalSettings(db, f.actors.superAdmin, { downPaymentPct: "40", roiPerSqft: "1000" });
    await updateTask(db, f.actors.agent1, taskId, { proposal: { customerName: "Ali B", projectId: f.projectId, unitId, installmentCount: "24" } });
    const p = (await taskRow(taskId)).proposal!;
    expect(p).toMatchObject({ customerName: "Ali B", downPaymentPct: 30, installmentCount: 24, roiPerSqft: null });
    expect(await rowsOf(taskId)).toHaveLength(25);
    // A manager can set the down payment; new proposals pick up the new defaults.
    const { taskId: t2 } = await proposal(f.actors.manager, { downPaymentPct: "25" });
    expect((await taskRow(t2)).proposal).toMatchObject({ downPaymentPct: 25, roiPerSqft: 1000, roiAnnual: 500_000 });
    const { taskId: t3 } = await proposal(f.actors.agent2);
    expect((await taskRow(t3)).proposal?.downPaymentPct).toBe(40);
  });

  it("stores hand-edited rows and rebuilds them from the saved figures", async () => {
    const { taskId } = await proposal(f.actors.agent1, { installmentCount: "2" });
    const edited = [
      { label: "Booking", amount: "3000000", progress: "On signing" },
      { label: "Grey structure", amount: "4000000", dueOn: "2027-03-10" },
      { label: "Possession", amount: "3000000", dueOn: "2027-09-10" },
    ];
    await updateTask(db, f.actors.agent1, taskId, { proposal: { customerName: "Ali", projectId: f.projectId, unitId, installmentCount: "2" }, rows: edited });
    expect((await rowsOf(taskId)).map((r) => [r.seq, r.label, r.progress, r.amount])).toEqual([
      [1, "Booking", "On signing", 3_000_000],
      [2, "Grey structure", null, 4_000_000],
      [3, "Possession", null, 3_000_000],
    ]);
    expect(await fieldOf(updateTask(db, f.actors.agent1, taskId, { rows: [{ label: "", amount: "1" }] }))).toBe("rows.0.label");
    // Q43: every installment row needs a due date on the 10th (the down payment row needs none).
    expect(await fieldOf(updateTask(db, f.actors.agent1, taskId, { rows: [edited[0], { label: "Grey", amount: "7000000" }] }))).toBe("rows.1.dueOn");
    expect(await fieldOf(updateTask(db, f.actors.agent1, taskId, { rows: [edited[0], { label: "Grey", amount: "7000000", dueOn: "2027-03-15" }] }))).toBe("rows.1.dueOn");
    await rebuildInstallments(db, f.actors.agent1, taskId);
    expect((await rowsOf(taskId)).map((r) => r.label)).toEqual(["Down payment", "Installment 1", "Installment 2"]);
    expect((await db.select().from(taskHistory).where(eq(taskHistory.taskId, taskId))).map((h) => h.action).sort()).toEqual(["create", "plan", "rebuild"]);
  });

  it("uses the default rate when a unit has no list price, and has no schedule when neither is set", async () => {
    const [free] = await db.insert(units).values({ projectId: f.projectId, unitNo: "B-1", areaSqft: 400, basePrice: 0 }).returning();
    const { taskId } = await proposal(f.actors.agent1, { unitId: free.id });
    expect((await taskRow(taskId)).proposal).toMatchObject({ pricePerSqft: null, totalList: null });
    expect(await rowsOf(taskId)).toHaveLength(0);
    await updateProposalSettings(db, f.actors.superAdmin, { defaultPricePerSqft: "15000" });
    const { taskId: t2 } = await proposal(f.actors.agent1, { unitId: free.id });
    expect((await taskRow(t2)).proposal).toMatchObject({ pricePerSqft: 15_000, totalList: 6_000_000 });
  });

  it("changes status with completion time and history; cancelled tasks can't be edited", async () => {
    const { taskId } = await general(f.actors.agent1);
    await setTaskStatus(db, f.actors.agent1, taskId, { status: "done" });
    expect((await taskRow(taskId)).completedAt).not.toBeNull();
    await setTaskStatus(db, f.actors.agent1, taskId, { status: "cancelled" });
    expect((await taskRow(taskId)).completedAt).toBeNull();
    expect(await errorCode(updateTask(db, f.actors.agent1, taskId, { title: "New" }))).toBe("BUSINESS_RULE");
    await setTaskStatus(db, f.actors.agent1, taskId, { status: "open" });
    await updateTask(db, f.actors.agent1, taskId, { title: "New" });
    expect((await taskRow(taskId)).title).toBe("New");
    expect(await errorCode(setTaskStatus(db, f.actors.agent1, taskId, { status: "archived" }))).toBe("VALIDATION_FAILED");
  });

  it("switching a proposal to General removes the plan and its rows", async () => {
    const { taskId } = await proposal(f.actors.agent1);
    await updateTask(db, f.actors.agent1, taskId, { type: "general" });
    expect((await taskRow(taskId)).proposal).toBeNull();
    expect(await rowsOf(taskId)).toHaveLength(0);
    expect(await fieldOf(updateTask(db, f.actors.agent1, taskId, { type: "payment_plan" }))).toBe("proposal.customerName");
  });

  it("reassigns within scope and records it", async () => {
    const { taskId } = await general(f.actors.manager);
    await updateTask(db, f.actors.manager, taskId, { assigneeId: f.actors.agent2.id });
    expect((await taskRow(taskId)).assigneeId).toBe(f.actors.agent2.id);
    expect((await db.select().from(taskHistory).where(eq(taskHistory.taskId, taskId))).map((h) => h.action).sort()).toEqual(["assign", "create", "update"]);
    expect(await fieldOf(updateTask(db, f.actors.agent2, taskId, { assigneeId: f.actors.agent1.id }))).toBe("assigneeId");
  });

  it("flags overdue tasks (past due, open or in progress) for the list and To-dos", async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const { taskId: late } = await general(f.actors.agent1, { dueAt: past, title: "Late" });
    const { taskId: done } = await general(f.actors.agent1, { dueAt: past, title: "Finished" });
    await general(f.actors.agent1, { dueAt: new Date(Date.now() + 86_400_000).toISOString(), title: "Later" });
    await setTaskStatus(db, f.actors.agent1, done, { status: "done" });
    const todo = await overdueTasks(db, f.actors.agent1);
    expect(todo.count).toBe(1);
    expect(todo.rows[0].id).toBe(late);
    expect((await listTasks(db, f.actors.agent1, { overdue: "1" })).rows.map((r) => r.id)).toEqual([late]);
    expect((await overdueTasks(db, f.actors.agent2)).count).toBe(0);
    expect((await overdueTasks(db, f.actors.hr)).count).toBe(0);
  });

  it("searches, filters, sorts and paginates", async () => {
    for (let i = 0; i < 27; i++) await general(f.actors.agent1, { title: `Task ${String(i).padStart(2, "0")}` });
    await proposal(f.actors.agent1, {}, { title: "Zeta proposal" });
    const first = await listTasks(db, f.actors.agent1, { sort: "title", dir: "asc" });
    expect(first.total).toBe(28);
    expect(first.rows).toHaveLength(25);
    expect(first.rows[0].title).toBe("Task 00");
    expect((await listTasks(db, f.actors.agent1, { sort: "title", dir: "asc", page: "2" })).rows.map((r) => r.title)).toEqual(["Task 25", "Task 26", "Zeta proposal"]);
    expect((await listTasks(db, f.actors.agent1, { q: "zeta" })).total).toBe(1);
    expect((await listTasks(db, f.actors.agent1, { type: "proposal" })).total).toBe(1);
    expect((await listTasks(db, f.actors.agent1, { status: "done" })).total).toBe(0);
    expect((await listTasks(db, f.actors.agent1, { assignee: "me" })).total).toBe(28);
    expect((await listTasks(db, f.actors.agent1, { q: "100%_" })).total).toBe(0);
  });

  it("settings: admins only, audited; blank clears optional values; form options respect scope", async () => {
    expect(await errorCode(updateProposalSettings(db, f.actors.manager, { agentCap: "10" }))).toBe("FORBIDDEN");
    await updateProposalSettings(db, f.actors.superAdmin, { agentCap: "7", managerCap: "12" });
    expect(await getProposalSettings(db)).toMatchObject({ agentCap: 7, managerCap: 12 });
    await updateProposalSettings(db, f.actors.superAdmin, { managerCap: "" });
    expect((await getProposalSettings(db)).managerCap).toBeNull();
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "app.setting"))).length).toBe(3);
    const options = await taskFormOptions(db, f.actors.agent1, f.projectId);
    expect(options.assignees.map((a) => a.id)).toEqual([f.actors.agent1.id]);
    expect(options.limits).toEqual({ discountCap: 7, canEditDownPayment: false });
    expect((await taskFormOptions(db, f.actors.manager, f.projectId)).assignees.map((a) => a.id).sort()).toEqual(
      [f.actors.manager.id, f.actors.agent1.id, f.actors.agent2.id].sort(),
    );
  });

  it("admin (not only super admin) has full Tasks access: all records, any assignee, no discount cap, settings", async () => {
    const [u] = await db.insert(users).values({ name: "Admin", email: "admin@test.local", role: "admin", passwordHash: "x" }).returning();
    const admin = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    await general(f.actors.outsideAgent);
    expect((await listTasks(db, admin, {})).total).toBe(1);
    const { taskId } = await proposal(admin, { discountPct: "20", downPaymentPct: "25", installmentCount: "12" }, { assigneeId: f.actors.agent1.id });
    expect((await taskRow(taskId)).proposal).toMatchObject({ discountPct: 20, downPaymentPct: 25, afterDiscount: 8_000_000, downPayment: 2_000_000, eachInstallment: 500_000 });
    await updateTask(db, admin, taskId, { assigneeId: f.actors.outsideAgent.id });
    await updateProposalSettings(db, admin, { managerCap: "8" });
    expect((await getProposalSettings(db)).managerCap).toBe(8);
    expect((await taskFormOptions(db, admin, f.projectId)).limits).toEqual({ discountCap: 100, canEditDownPayment: true });
  });

  it("a proposal linked to a booking never creates or changes Finance records", async () => {
    const lead = await leadOf(f.actors.agent1);
    const { bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: lead, unitId, ratePerSqft: "20000", tokenAmount: "500000" });
    const before = (await db.select({ n: count() }).from(bookingPayments))[0].n;
    // A payment plan for the booking uses the booked (no longer available) unit.
    const { taskId } = await proposal(f.actors.agent1, {}, { type: "payment_plan", leadId: lead, bookingId });
    await rebuildInstallments(db, f.actors.agent1, taskId);
    expect((await db.select({ n: count() }).from(bookingPayments))[0].n).toBe(before);
  });

  it("database constraints back the rules: plan matches type, done has a completion time", async () => {
    const { taskId } = await general(f.actors.agent1);
    await expect(db.update(tasks).set({ type: "proposal" }).where(eq(tasks.id, taskId))).rejects.toThrow();
    await expect(db.update(tasks).set({ status: "done" }).where(eq(tasks.id, taskId))).rejects.toThrow();
    await expect(db.insert(taskInstallmentRows).values({ taskId, seq: 1, label: "x", amount: -1 })).rejects.toThrow();
  });

  describe("questionnaire rules (Q37, Q41–Q43, Q48)", () => {
    it("installments are due on the 10th of consecutive months from the chosen first month, across years", async () => {
      const { taskId } = await proposal(f.actors.agent1, { installmentCount: "3", firstInstallmentMonth: "2026-11" });
      const rows = await rowsOf(taskId);
      expect(rows.map((r) => [r.label, r.dueOn])).toEqual([
        ["Down payment", null],
        ["Installment 1", "2026-11-10"],
        ["Installment 2", "2026-12-10"],
        ["Installment 3", "2027-01-10"],
      ]);
      // The rounding remainder still lands on the last installment (Q37).
      expect(rows.reduce((n, r) => n + r.amount, 0)).toBe((await taskRow(taskId)).proposal!.afterDiscount);
    });

    it("hand-edited rows are checked on create too", async () => {
      const rows = [{ label: "Down payment", amount: "2500000" }, { label: "Installment 1", amount: "7500000", dueOn: "2027-01-11" }];
      expect(await fieldOf(proposal(f.actors.agent1, { installmentCount: "1" }, { rows }))).toBe("rows.1.dueOn");
      rows[1].dueOn = "2027-01-10";
      expect(await fieldOf(proposal(f.actors.agent1, { installmentCount: "1" }, { rows }))).toBeNull();
    });

    it("the first installment month is required on every saved proposal", async () => {
      expect(await fieldOf(proposal(f.actors.agent1, { firstInstallmentMonth: null }))).toBe("proposal.firstInstallmentMonth");
      expect(await fieldOf(proposal(f.actors.agent1, { firstInstallmentMonth: "2027-13" }))).toBe("proposal.firstInstallmentMonth");
    });

    it("only Available units can be quoted; a proposal keeps its unit if that unit is booked later", async () => {
      const { taskId } = await proposal(f.actors.agent1);
      await db.update(units).set({ status: "reserved" }).where(eq(units.id, unitId));
      expect(await fieldOf(proposal(f.actors.agent1))).toBe("proposal.unitId");
      expect(await fieldOf(proposal(f.actors.agent1, {}, { type: "payment_plan" }))).toBeNull();
      // The existing proposal can still be edited with the same (now reserved) unit.
      await updateTask(db, f.actors.agent1, taskId, { proposal: { customerName: "Ali C", projectId: f.projectId, unitId, installmentCount: "12" } });
      expect((await taskRow(taskId)).proposal).toMatchObject({ customerName: "Ali C", unitId });
    });

    it("Q47: a unit price change updates saved proposals automatically, keeping the old figures in history", async () => {
      const { taskId: generated } = await proposal(f.actors.agent1, { installmentCount: "2" });
      const { taskId: edited } = await proposal(f.actors.agent1, { installmentCount: "2" });
      const editedRows = [
        { label: "Down payment", amount: "2500000" },
        { label: "Grey structure", amount: "4000000", dueOn: "2027-02-10" },
        { label: "Possession", amount: "3500000", dueOn: "2027-08-10" },
      ];
      await updateTask(db, f.actors.agent1, edited, { rows: editedRows });
      const { taskId: cancelled } = await proposal(f.actors.agent1);
      await setTaskStatus(db, f.actors.agent1, cancelled, { status: "cancelled" });
      const { taskId: plan } = await proposal(f.actors.agent1, {}, { type: "payment_plan" });

      const result = await updateUnit(db, f.actors.superAdmin, unitId, { basePrice: "11000000" });
      expect(result).toMatchObject({ proposalsUpdated: 2 });

      // Generated schedule: figures and rows follow the new price (the fixture uses 30% down).
      expect((await taskRow(generated)).proposal).toMatchObject({ pricePerSqft: 22_000, totalList: 11_000_000, afterDiscount: 11_000_000, downPayment: 3_300_000 });
      expect((await rowsOf(generated)).map((r) => r.amount)).toEqual([3_300_000, 3_850_000, 3_850_000]);
      // Hand-edited schedule: figures follow, the rows are kept as edited.
      expect((await taskRow(edited)).proposal).toMatchObject({ totalList: 11_000_000 });
      expect((await rowsOf(edited)).map((r) => r.label)).toEqual(["Down payment", "Grey structure", "Possession"]);
      // Cancelled proposals and booking payment plans are not touched.
      expect((await taskRow(cancelled)).proposal).toMatchObject({ totalList: 10_000_000 });
      expect((await taskRow(plan)).proposal).toMatchObject({ totalList: 10_000_000 });

      // The previous figures stay in the history and audit log.
      const history = await db.select().from(taskHistory).where(and(eq(taskHistory.taskId, generated), eq(taskHistory.action, "price_sync")));
      expect(history[0].data).toMatchObject({ before: { pricePerSqft: 20_000, totalList: 10_000_000 }, after: { pricePerSqft: 22_000, totalList: 11_000_000 }, rowsRegenerated: true });
      expect((await db.select().from(taskHistory).where(and(eq(taskHistory.taskId, edited), eq(taskHistory.action, "price_sync"))))[0].data).toMatchObject({ rowsRegenerated: false });
      expect((await db.select().from(auditLogs).where(and(eq(auditLogs.action, "task.price_sync"), eq(auditLogs.entityId, generated)))).length).toBe(1);
      expect((await getTaskDetail(db, f.actors.agent1, generated)).unitChanged).toBeNull();

      // Changing something other than price or area doesn't touch proposals.
      expect(await updateUnit(db, f.actors.superAdmin, unitId, { comment: "Corner unit" })).toEqual({ changed: ["comment"] });
    });

    it("managers fall back to the 5% manager cap from migration 0014 (Q41)", async () => {
      await db.insert(appSettings).values({ key: "proposal.manager_discount_cap_pct", value: "5" });
      expect(await fieldOf(proposal(f.actors.manager, { discountPct: "5.5" }))).toBe("proposal.discountPct");
      expect(await fieldOf(proposal(f.actors.manager, { discountPct: "5" }))).toBeNull();
    });
  });

  it("Q45: Admins assign tasks to all users; HR sees and updates only their own; others can't assign to HR", async () => {
    const hr = f.actors.hr;
    expect(await fieldOf(general(f.actors.manager, { assigneeId: hr.id }))).toBe("assigneeId");
    expect(await fieldOf(general(f.actors.agent1, { assigneeId: hr.id }))).toBe("assigneeId");
    const { taskId } = await general(f.actors.superAdmin, { assigneeId: hr.id, title: "Collect CNIC copies" });
    await general(f.actors.superAdmin, { title: "Not for HR" });
    expect((await listTasks(db, hr, {})).rows.map((r) => r.title)).toEqual(["Collect CNIC copies"]);
    expect((await setTaskStatus(db, hr, taskId, { status: "done" })).changed).toBe(true);
    // HR can't hand the task to someone else.
    expect(await fieldOf(updateTask(db, hr, taskId, { assigneeId: f.actors.agent1.id }))).toBe("assigneeId");
    const options = await taskFormOptions(db, f.actors.superAdmin, f.projectId);
    expect(options.assignees.map((a) => a.id)).toContain(hr.id);
    // A task linked to a lead HR can't see opens without revealing the lead.
    const leadId = await leadOf(f.actors.agent1);
    const { taskId: linked } = await general(f.actors.superAdmin, { assigneeId: hr.id, leadId });
    const detail = await getTaskDetail(db, hr, linked);
    expect(detail.lead).toBeNull();
    // HR's edit form loads, offering only themselves as assignee.
    expect((await taskFormOptions(db, hr, f.projectId)).assignees.map((a) => a.id)).toEqual([hr.id]);
  });
});
