import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, createBooking } from "@/modules/bookings/commands";
import { convertLeadToClient, createClient } from "@/modules/clients/commands";
import { getClientDetail } from "@/modules/clients/queries";
import { createUnit } from "@/modules/inventory/commands";
import { addNote, createLead } from "@/modules/leads/commands";
import { getLeadDetail } from "@/modules/leads/queries";
import { clientActivities, leadActivities, leads } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const PATH = ["down_payment", "agreement_pending"];

describe.skipIf(!hasTestDb)("FR-025: everything reaches the lead's timeline (PostgreSQL integration)", () => {
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

  const newLead = async (overrides: Record<string, unknown> = {}) => {
    const r = await createLead(db, f.actors.agent1, leadInput(f, overrides));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };
  const phoneOf = async (leadId: string) => (await db.select().from(leads).where(eq(leads.id, leadId)))[0];
  const links = (leadId: string) => db.select().from(leadActivities).where(and(eq(leadActivities.leadId, leadId), eq(leadActivities.type, "client_linked")));
  const book = async (actor: Actor, leadId: string) => {
    const { unitId } = await createUnit(db, f.actors.superAdmin, {
      projectId: f.projectId,
      unitNo: `U-${Math.random().toString(36).slice(2, 7)}`,
      areaSqft: "500",
      basePrice: "10000000",
    });
    return createBooking(db, actor, { projectId: f.projectId, leadId, unitId, ratePerSqft: "25,000", tokenAmount: "500000", reservedUntil: "2099-01-01" });
  };
  const confirm = async (bookingId: string) => {
    for (const toStage of [...PATH, "confirmed"]) await advanceBooking(db, f.actors.manager, bookingId, { toStage });
  };

  it("a new lead records its client on the lead, by the person who added it", async () => {
    // Every lead creates or joins its person's client (13 Nov 2026).
    const leadId = await newLead();
    const { clientId } = await phoneOf(leadId);
    const [entry] = await links(leadId);
    expect(entry).toMatchObject({ actorId: f.actors.agent1.id, data: { clientId, mode: "created" } });
    expect((await getLeadDetail(db, f.actors.manager, leadId)).activities.some((a) => a.type === "client_linked")).toBe(true);
  });

  it("a lead joining an existing client records it", async () => {
    const { clientId } = await createClient(db, f.actors.superAdmin, { name: "Existing", phoneCountryCode: "+92", phoneNumber: "03001110001", ownerId: f.actors.agent1.id });
    const leadId = await newLead({ phoneNumber: "0300 1110001" });
    expect((await links(leadId)).map((l) => l.data)).toEqual([{ clientId, mode: "linked" }]);
  });

  it("an already linked lead records no second link when it books and confirms", async () => {
    const leadId = await newLead();
    await convertLeadToClient(db, f.actors.manager, { leadId });
    const { bookingId } = await book(f.actors.agent1, leadId);
    await confirm(bookingId);
    expect(await links(leadId)).toHaveLength(1);
  });

  it("converting a lead that already has its client records nothing more", async () => {
    const leadId = await newLead();
    await convertLeadToClient(db, f.actors.manager, { leadId });
    await expect(convertLeadToClient(db, f.actors.agent2, { leadId })).rejects.toThrow();
    expect(await links(leadId)).toHaveLength(1);
  });

  it("the entry names no client, because the lead's viewers may not have access to it", async () => {
    const leadId = await newLead({ name: "Private Person" });
    await convertLeadToClient(db, f.actors.manager, { leadId });
    const [entry] = await links(leadId);
    expect(Object.keys(entry.data as object).sort()).toEqual(["clientId", "mode"]);
    expect(entry.body).toBeNull();
  });

  it("linking does not count as a first touch or change last activity", async () => {
    const leadId = await newLead();
    const before = await phoneOf(leadId);
    await convertLeadToClient(db, f.actors.manager, { leadId });
    const after = await phoneOf(leadId);
    expect(after.firstTouchAt).toEqual(before.firstTouchAt);
    expect(after.lastActivityAt).toEqual(before.lastActivityAt);
  });

  it("the client's own timeline is unchanged", async () => {
    const leadId = await newLead();
    const { clientId } = await convertLeadToClient(db, f.actors.manager, { leadId });
    const rows = await db.select().from(clientActivities).where(eq(clientActivities.clientId, clientId));
    expect(rows.map((r) => r.type)).toEqual(["created"]);
  });

  it("the lead's timeline shows every entry past 100, newest first", async () => {
    const leadId = await newLead();
    const base = Date.now() - 200 * 60_000;
    await db.insert(leadActivities).values(
      Array.from({ length: 130 }, (_, i) => ({ leadId, actorId: f.actors.agent1.id, type: "note" as const, body: `Old ${i}`, createdAt: new Date(base + i * 60_000) })),
    );
    await addNote(db, f.actors.agent1, leadId, { body: "Latest note" });
    const { activities } = await getLeadDetail(db, f.actors.agent1, leadId);
    expect(activities.filter((a) => a.type === "note")).toHaveLength(131);
    expect(activities[0].body).toBe("Latest note");
    expect(activities.some((a) => a.body === "Old 0")).toBe(true);
    const times = activities.map((a) => new Date(a.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("the client's timeline also shows every entry past 100", async () => {
    const clientId = (await createClient(db, f.actors.superAdmin, { name: "Long History", phoneCountryCode: "+92", phoneNumber: "03009998877" })).clientId;
    await db.insert(clientActivities).values(Array.from({ length: 120 }, (_, i) => ({ clientId, actorId: f.actors.superAdmin.id, type: "note" as const, body: `Old ${i}` })));
    expect((await getClientDetail(db, f.actors.superAdmin, clientId)).activities.length).toBeGreaterThan(120);
  });
});
