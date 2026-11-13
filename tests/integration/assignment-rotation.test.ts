import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { businessToday } from "@/modules/bookings/today";
import { ROTATION_LAST_KEY } from "@/modules/leads/assignment";
import { createLead } from "@/modules/leads/commands";
import { decideImportBatch, submitImport } from "@/modules/leads/imports";
import { appSettings, leadAssignments, leadImportRows, leads, rosterEntries, teamMembers } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

/**
 * Equal rotation (owner's decision, 13 Nov 2026): leads with no chosen owner (imports, the API, an
 * admin adding one by hand) go to the next available agent in one shared loop, ordered by name,
 * whatever their performance. Fixture agents in name order: Agent A, Agent B, Agent Outside.
 */
describe.skipIf(!hasTestDb)("Lead assignment: equal rotation (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let order: string[];

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    order = [f.actors.agent1.id, f.actors.agent2.id, f.actors.outsideAgent.id];
  });

  let phoneSeq = 0;
  const phone = () => `0301${String(4_000_000 + phoneSeq++).padStart(7, "0")}`;
  const add = async (actor: Actor = f.actors.superAdmin) => {
    const r = await createLead(db, actor, leadInput(f, { phoneNumber: phone() }));
    if (r.outcome !== "created") throw new Error("setup");
    const [row] = await db.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, r.leadId));
    return { leadId: r.leadId, ownerId: row.ownerId };
  };
  const owners = async (n: number, actor?: Actor) => {
    const out: (string | null)[] = [];
    for (let i = 0; i < n; i++) out.push((await add(actor)).ownerId);
    return out;
  };
  const rosterOff = async (userId: string, status: "leads_off" | "on_leave") => {
    const [m] = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, userId));
    await db.insert(rosterEntries).values({ teamId: m.teamId, userId, date: businessToday(new Date()), status });
  };

  it("hands leads out one each, in name order, and loops back to the first agent", async () => {
    expect(await owners(7)).toEqual([...order, ...order, order[0]]);
  });

  it("gives every agent an equal share whatever their record", async () => {
    // Agent B already holds many leads and Agent A has none: the rotation ignores both.
    for (let i = 0; i < 5; i++) await createLead(db, f.actors.agent2, leadInput(f, { phoneNumber: phone() }));
    const got = await owners(6);
    for (const id of order) expect(got.filter((o) => o === id)).toHaveLength(2);
  });

  it("records the turn as a rotation decision with the order used", async () => {
    const { leadId } = await add();
    const [h] = await db.select().from(leadAssignments).where(eq(leadAssignments.leadId, leadId));
    expect(h).toMatchObject({ mode: "rotation", assigneeId: order[0], reason: "Next in the equal rotation (3 available agents)" });
    expect(h.breakdown).toMatchObject({ method: "rotation", order: ["Agent A", "Agent B", "Agent Outside"] });
    const [pointer] = await db.select().from(appSettings).where(eq(appSettings.key, ROTATION_LAST_KEY));
    expect(pointer.value).toBe(order[0]);
  });

  it("skips agents on leave or leads off today, and they rejoin in their usual place", async () => {
    await rosterOff(f.actors.agent2.id, "leads_off");
    expect(await owners(4)).toEqual([order[0], order[2], order[0], order[2]]);
    await db.delete(rosterEntries).where(eq(rosterEntries.userId, f.actors.agent2.id));
    // The last turn went to Agent Outside, so the loop restarts at Agent A, then Agent B is back.
    expect(await owners(3)).toEqual(order);
  });

  it("leaves the lead unassigned when no agent is available", async () => {
    for (const id of order) await rosterOff(id, "on_leave");
    expect((await add()).ownerId).toBeNull();
  });

  it("keeps the turn across separate lead sources: an import batch continues where the last lead stopped", async () => {
    await owners(1); // Agent A
    const csv = ["name,phone,source", `Import One,${phone()},Facebook`, `Import Two,${phone()},Facebook`, `Import Three,${phone()},Facebook`].join("\n");
    const batch = await submitImport(db, f.actors.superAdmin, { projectId: f.projectId, fileName: "batch.csv", csv });
    await decideImportBatch(db, f.actors.superAdmin, batch.batchId, { approve: true });
    const rows = await db.select({ leadId: leadImportRows.leadId, rowNo: leadImportRows.rowNo }).from(leadImportRows).where(eq(leadImportRows.batchId, batch.batchId));
    const ids = rows.sort((a, b) => a.rowNo - b.rowNo).map((r) => r.leadId!);
    const imported = await db.select({ id: leads.id, ownerId: leads.ownerId }).from(leads).where(inArray(leads.id, ids));
    expect(ids.map((id) => imported.find((l) => l.id === id)!.ownerId)).toEqual([order[1], order[2], order[0]]);
  });

  it("does not change an agent's own leads, a chosen owner, or the turn", async () => {
    expect((await add(f.actors.agent2)).ownerId).toBe(f.actors.agent2.id);
    const chosen = await createLead(db, f.actors.superAdmin, leadInput(f, { phoneNumber: phone(), ownerId: f.actors.outsideAgent.id }));
    if (chosen.outcome !== "created") throw new Error("setup");
    const [row] = await db.select({ ownerId: leads.ownerId }).from(leads).where(and(eq(leads.id, chosen.leadId)));
    expect(row.ownerId).toBe(f.actors.outsideAgent.id);
    // Neither moved the rotation: the next automatic lead still goes to the first agent.
    expect((await add()).ownerId).toBe(order[0]);
  });
});
