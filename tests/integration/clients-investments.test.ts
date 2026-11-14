import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "@/modules/bookings/commands";
import { convertLeadToClient } from "@/modules/clients/commands";
import { listClients } from "@/modules/clients/queries";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { bookings } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

describe.skipIf(!hasTestDb)("Clients: latest investment and project filter (PostgreSQL integration)", () => {
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

  /** A client from `owner`'s lead in `projectId`, with one booking per entry of `bookingsIn`. */
  const clientWith = async (owner: Actor, projectId: string, unitNos: string[]) => {
    const lead = await createLead(db, owner, leadInput(f, { projectId }));
    if (lead.outcome !== "created") throw new Error("setup");
    const { clientId } = await convertLeadToClient(db, f.actors.superAdmin, { leadId: lead.leadId });
    const ids: string[] = [];
    for (const unitNo of unitNos) {
      const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId, unitNo, areaSqft: "500", basePrice: "1" });
      const { bookingId } = await createBooking(db, owner, { projectId, leadId: lead.leadId, unitId, ratePerSqft: "1000", tokenAmount: "20000" });
      await db.update(bookings).set({ clientId }).where(eq(bookings.id, bookingId));
      ids.push(bookingId);
    }
    return { clientId, bookingIds: ids };
  };

  it("shows the latest booking that is not cancelled, and none for clients without bookings", async () => {
    const a = await clientWith(f.actors.agent1, f.projectId, ["A-1", "A-2"]);
    const none = await clientWith(f.actors.agent1, f.projectId, []);
    // The newest booking is cancelled, so the previous one is the latest investment.
    await db.update(bookings).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(bookings.id, a.bookingIds[0]));
    await db.update(bookings).set({ stage: "cancelled", cancelledAt: new Date(), cancelledReason: "Test" }).where(eq(bookings.id, a.bookingIds[1]));
    const rows = (await listClients(db, f.actors.superAdmin, {})).rows;
    expect(rows.find((r) => r.id === a.clientId)?.latestInvestment).toMatchObject({ bookingId: a.bookingIds[0], projectName: "Test Project", unitNo: "A-1" });
    expect(rows.find((r) => r.id === none.clientId)?.latestInvestment).toBeNull();
  });

  it("filters clients by project investment within the actor's booking scope", async () => {
    const inTest = await clientWith(f.actors.agent1, f.projectId, ["B-1"]);
    const inOther = await clientWith(f.actors.outsideAgent, f.otherProjectId, ["C-1"]);
    const ids = async (actor: Actor, project?: string) => (await listClients(db, actor, project ? { project } : {})).rows.map((r) => r.id).sort();

    expect(await ids(f.actors.superAdmin, f.projectId)).toEqual([inTest.clientId]);
    expect(await ids(f.actors.superAdmin, f.otherProjectId)).toEqual([inOther.clientId]);
    // A cancelled booking is not an investment.
    await db.update(bookings).set({ stage: "cancelled", cancelledAt: new Date(), cancelledReason: "Test" }).where(eq(bookings.id, inTest.bookingIds[0]));
    expect(await ids(f.actors.superAdmin, f.projectId)).toEqual([]);
    // An invalid project id is ignored rather than failing.
    expect((await listClients(db, f.actors.superAdmin, { project: "not-a-uuid" })).query.project).toBeUndefined();
  });

  it("never reveals bookings outside the actor's booking scope", async () => {
    const other = await clientWith(f.actors.outsideAgent, f.otherProjectId, ["D-1"]);
    const visible = await listClients(db, f.actors.manager, {});
    const row = visible.rows.find((r) => r.id === other.clientId);
    // The manager may or may not see the client itself, but never the other team's booking.
    if (row) expect(row.latestInvestment).toBeNull();
    expect((await listClients(db, f.actors.manager, { project: f.otherProjectId })).total).toBe(0);
  });
});
