import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { completeFollowUp, createLead, markLost } from "@/modules/leads/commands";
import { leadTodos, TODO_BUCKETS, type TodoBucket } from "@/modules/leads/queries";
import { overdueMeetings } from "@/modules/meetings/queries";
import { overdueTasks } from "@/modules/tasks/queries";
import { followUps, leads, meetings, tasks } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

// 11:00 in Pakistan, so the buckets don't depend on when the suite runs.
const NOW = new Date("2026-11-03T06:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const DAY = 24 * 60;

describe.skipIf(!hasTestDb)("FR-027: every To-dos item a count promises can be reached (PostgreSQL integration)", () => {
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

  const newLead = async (owner: Actor = f.actors.agent1) => {
    const r = await createLead(db, f.actors.superAdmin, leadInput(f, { ownerId: owner.id }));
    if (r.outcome !== "created") throw new Error("lead");
    return r.leadId;
  };
  const addFollowUps = (leadId: string, n: number, dueAt: (i: number) => Date, extra: Partial<typeof followUps.$inferInsert> = {}, assigneeId = f.actors.agent1.id) =>
    db.insert(followUps).values(Array.from({ length: n }, (_, i) => ({ leadId, assigneeId, dueAt: dueAt(i), note: `Item ${i}`, ...extra }))).returning({ id: followUps.id });
  /** Every item of a bucket, walking all its pages. */
  const walk = async (actor: Actor, bucket: TodoBucket) => {
    const first = await leadTodos(db, actor, f.projectId, bucket, NOW);
    const items = [...first.items];
    for (let page = 2; page <= first.pageCount; page += 1) items.push(...(await leadTodos(db, actor, f.projectId, bucket, NOW, page)).items);
    return { items, first };
  };

  it("a bucket above the old limit of 200 pages to the end: count equals what can be opened", async () => {
    const leadId = await newLead();
    await addFollowUps(leadId, 230, (i) => at(-10_000 + i));
    const first = await leadTodos(db, f.actors.agent1, f.projectId, "overdue", NOW);
    expect(first).toMatchObject({ page: 1, pageCount: 5 });
    expect(first.counts.overdue).toBe(230);
    expect(first.items).toHaveLength(50);
    const last = await leadTodos(db, f.actors.agent1, f.projectId, "overdue", NOW, 5);
    expect(last.items).toHaveLength(30);
    const { items } = await walk(f.actors.agent1, "overdue");
    expect(new Set(items.map((i) => i.key)).size).toBe(230);
    // Oldest first, right to the last item, which the old list never showed.
    expect(items.map((i) => i.note)).toEqual(Array.from({ length: 230 }, (_, i) => `Item ${i}`));
  });

  it("every lead bucket: count equals the items across its pages", async () => {
    const leadId = await newLead();
    await addFollowUps(leadId, 53, () => at(60)); // today, 7d, 15d, 30d
    await addFollowUps(leadId, 52, () => at(DAY)); // tomorrow, 7d, 15d, 30d
    await addFollowUps(leadId, 51, () => at(12 * DAY)); // 15d, 30d
    await addFollowUps(leadId, 51, () => at(25 * DAY)); // 30d
    await addFollowUps(leadId, 54, () => at(-DAY)); // overdue
    await addFollowUps(leadId, 51, () => at(-120), { status: "done", doneAt: at(-30) }); // done today
    for (let i = 0; i < 52; i += 1) await newLead();
    await db.update(leads).set({ createdAt: at(-3 * DAY) }).where(eq(leads.stage, "new_lead"));

    const { counts } = await leadTodos(db, f.actors.agent1, f.projectId, "today", NOW);
    for (const bucket of TODO_BUCKETS) {
      const { items, first } = await walk(f.actors.superAdmin, bucket);
      expect(items.length, bucket).toBe(first.counts[bucket]);
      expect(new Set(items.map((i) => i.key)).size, bucket).toBe(items.length);
      expect(first.items.length, bucket).toBe(Math.min(50, first.counts[bucket]));
    }
    expect(counts.overdue).toBe(54);
  });

  it("equal due dates keep one order across pages", async () => {
    const leadId = await newLead();
    await addFollowUps(leadId, 120, () => at(-500));
    const one = (await walk(f.actors.agent1, "overdue")).items.map((i) => i.key);
    const two = (await walk(f.actors.agent1, "overdue")).items.map((i) => i.key);
    expect(new Set(one).size).toBe(120);
    expect(two).toEqual(one);
  });

  it("an out-of-range page lands on the last; junk means page 1; an empty bucket has one page", async () => {
    const leadId = await newLead();
    await addFollowUps(leadId, 55, () => at(-500));
    const page = (p: unknown) => leadTodos(db, f.actors.agent1, f.projectId, "overdue", NOW, p);
    expect(await page(99)).toMatchObject({ page: 2, pageCount: 2 });
    expect((await page(99)).items).toHaveLength(5);
    for (const junk of ["x", "-3", 0, 1.5, undefined, "2; drop table leads"]) expect((await page(junk)).page).toBe(1);
    expect((await page("2")).page).toBe(2);
    expect(await leadTodos(db, f.actors.agent2, f.projectId, "overdue", NOW)).toMatchObject({ page: 1, pageCount: 1, items: [] });
  });

  it("completing an item moves the count and keeps the rest reachable", async () => {
    const leadId = await newLead();
    await addFollowUps(leadId, 51, (i) => at(-1000 + i));
    const first = await leadTodos(db, f.actors.agent1, f.projectId, "overdue", NOW);
    await completeFollowUp(db, f.actors.agent1, first.items[0].followUpId!);
    const { items, first: after } = await walk(f.actors.agent1, "overdue");
    expect(after.counts.overdue).toBe(50);
    expect(after.pageCount).toBe(1);
    expect(items).toHaveLength(50);
    // A page that no longer exists falls back to the last one.
    expect((await leadTodos(db, f.actors.agent1, f.projectId, "overdue", NOW, 2)).page).toBe(1);
  });

  it("scope and the Lost rule hold on every page", async () => {
    const mine = await newLead(f.actors.agent1);
    const theirs = await newLead(f.actors.agent2);
    const outside = await newLead(f.actors.outsideAgent);
    const lost = await newLead(f.actors.agent1);
    await addFollowUps(mine, 55, () => at(-500));
    await addFollowUps(theirs, 3, () => at(-500), {}, f.actors.agent2.id);
    await addFollowUps(outside, 2, () => at(-500), {}, f.actors.outsideAgent.id);
    await addFollowUps(lost, 4, () => at(-500));
    await markLost(db, f.actors.manager, lost, { lostReasonId: f.lostReasonId });

    const agent = await walk(f.actors.agent1, "overdue");
    expect(agent.first.counts.overdue).toBe(55);
    expect(new Set(agent.items.map((i) => i.leadId))).toEqual(new Set([mine]));
    const manager = await walk(f.actors.manager, "overdue");
    expect(manager.first.counts.overdue).toBe(58);
    expect(new Set(manager.items.map((i) => i.leadId))).toEqual(new Set([mine, theirs]));
    expect((await walk(f.actors.superAdmin, "overdue")).items).toHaveLength(60);
  });

  it("overdue tasks page the same way, within the actor's scope", async () => {
    await db.insert(tasks).values(Array.from({ length: 55 }, (_, i) => ({ title: `Task ${i}`, type: "general" as const, assigneeId: f.actors.agent1.id, dueAt: at(-1000) })));
    const first = await overdueTasks(db, f.actors.agent1, NOW);
    expect(first).toMatchObject({ count: 55, page: 1, pageCount: 2 });
    expect(first.rows).toHaveLength(50);
    const last = await overdueTasks(db, f.actors.agent1, NOW, 2);
    expect(last.rows).toHaveLength(5);
    expect(new Set([...first.rows, ...last.rows].map((r) => r.id)).size).toBe(55);
    expect((await overdueTasks(db, f.actors.agent1, NOW, 99)).page).toBe(2);
    expect((await overdueTasks(db, f.actors.agent1, NOW, "x")).page).toBe(1);
    expect(await overdueTasks(db, f.actors.agent2, NOW)).toMatchObject({ count: 0, rows: [], pageCount: 1 });
  });

  it("overdue meetings page the same way, and HR still gets none", async () => {
    const leadId = await newLead();
    await db.insert(meetings).values(Array.from({ length: 55 }, (_, i) => ({ title: `Meeting ${i}`, leadId, organizerId: f.actors.agent1.id, startsAt: at(-1000) })));
    const first = await overdueMeetings(db, f.actors.agent1, NOW);
    expect(first).toMatchObject({ count: 55, page: 1, pageCount: 2 });
    expect(first.rows).toHaveLength(50);
    const last = await overdueMeetings(db, f.actors.agent1, NOW, 2);
    expect(last.rows).toHaveLength(5);
    expect(new Set([...first.rows, ...last.rows].map((r) => r.id)).size).toBe(55);
    expect(await overdueMeetings(db, f.actors.hr, NOW)).toMatchObject({ count: 0, rows: [], page: 1, pageCount: 1 });
  });
});
