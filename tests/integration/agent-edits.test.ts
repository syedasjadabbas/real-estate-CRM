import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { updateClient } from "@/modules/clients/commands";
import { getClientDetail } from "@/modules/clients/queries";
import { createLead, updateLead } from "@/modules/leads/commands";
import { getLeadDetail } from "@/modules/leads/queries";
import { leads, notifications } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

/** Owner, 14 Nov 2026: agents never change phone numbers; their renames are kept and reported. */
describe.skipIf(!hasTestDb)("Agent edits to customers (PostgreSQL integration)", () => {
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

  const newLead = async () => {
    const r = await createLead(db, f.actors.agent1, leadInput(f, { name: "Old Name", phoneNumber: "03001230001" }));
    if (r.outcome !== "created") throw new Error("setup");
    return r.leadId;
  };

  it("an agent can't change a lead's or client's phone numbers; resending the same number is fine; Admins can", async () => {
    const leadId = await newLead();
    expect(await codeOf(updateLead(db, f.actors.agent1, leadId, { phoneNumber: "03009990001" }))).toBe("FORBIDDEN");
    expect(await codeOf(updateLead(db, f.actors.agent1, leadId, { phones: [{ countryCode: "+92", number: "03009990002" }] }))).toBe("FORBIDDEN");
    expect(await codeOf(updateLead(db, f.actors.agent1, leadId, { phoneNumber: "0300 1230001", email: "same@number.pk" }))).toBe("ok");
    expect((await getLeadDetail(db, f.actors.agent1, leadId)).permissions.editPhones).toBe(false);

    const [{ clientId }] = await db.select({ clientId: leads.clientId }).from(leads).where(eq(leads.id, leadId));
    expect(await codeOf(updateClient(db, f.actors.agent1, clientId!, { phoneNumber: "03009990003" }))).toBe("FORBIDDEN");
    expect((await getClientDetail(db, f.actors.agent1, clientId!)).permissions.editPhones).toBe(false);

    expect(await codeOf(updateLead(db, f.actors.superAdmin, leadId, { phoneNumber: "03009990004" }))).toBe("ok");
  });

  it("an agent's rename shows old → new in the history and tells every Admin and Super Admin", async () => {
    const leadId = await newLead();
    await updateLead(db, f.actors.agent1, leadId, { name: "New Name" });
    const { activities } = await getLeadDetail(db, f.actors.agent1, leadId);
    expect(activities.find((a) => a.type === "update")?.data).toMatchObject({ fields: ["name"], nameFrom: "Old Name", nameTo: "New Name" });
    const told = await db.select().from(notifications).where(eq(notifications.type, "name_changed"));
    expect(told.map((n) => n.userId)).toContain(f.actors.superAdmin.id);
    expect(told.some((n) => n.userId === f.actors.agent1.id)).toBe(false);
    expect(told[0].title).toContain("Old Name → New Name");

    // An Admin's own rename is recorded but not broadcast.
    await updateLead(db, f.actors.superAdmin, leadId, { name: "Admin Name" });
    expect(await db.select().from(notifications).where(and(eq(notifications.type, "name_changed")))).toHaveLength(told.length);
  });
});
