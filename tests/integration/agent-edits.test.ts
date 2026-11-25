import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { updateClient } from "@/modules/clients/commands";
import { getClientDetail } from "@/modules/clients/queries";
import { createLead, updateLead } from "@/modules/leads/commands";
import { getLeadDetail } from "@/modules/leads/queries";
import { leads } from "@/server/db/schema";
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

  // An agent's rename waits for an Admin: lead-requests.test.ts (25 Nov 2026).
});
