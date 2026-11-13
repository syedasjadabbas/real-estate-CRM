import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addNote, changeStage, createLead, updateLead } from "@/modules/leads/commands";
import { pendingVerification, resubmitLead, verifyLead } from "@/modules/leads/verification";
import { leads, notifications } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { verificationMode } from "../support/approved-leads";
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

/** Owner's rule of 13 Nov 2026: an agent's hand-added lead waits for an Admin or Super Admin to verify it. */
describe.skipIf(!hasTestDb)("Lead verification (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
    verificationMode.keepLeadsPending = true;
  });
  afterAll(async () => {
    verificationMode.keepLeadsPending = false;
    await close();
  });
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
  });

  const leadBy = async (actor: Actor) => {
    const r = await createLead(db, actor, leadInput(f));
    if (r.outcome !== "created") throw new Error("setup");
    return r;
  };
  const statusOf = async (id: string) => (await db.select({ v: leads.verification }).from(leads).where(eq(leads.id, id)))[0].v;

  it("an agent's lead waits for verification, locked for the agent and listed for Admins, who are told", async () => {
    const r = await leadBy(f.actors.agent1);
    expect(r.verification).toBe("pending");
    expect(await statusOf(r.leadId)).toBe("pending");
    expect(await codeOf(changeStage(db, f.actors.agent1, r.leadId, { stage: "contact_attempted" }))).toBe("BUSINESS_RULE");
    expect(await codeOf(addNote(db, f.actors.agent1, r.leadId, { body: "Called" }))).toBe("BUSINESS_RULE");
    expect(await codeOf(updateLead(db, f.actors.agent1, r.leadId, { name: "Changed" }))).toBe("BUSINESS_RULE");
    expect((await pendingVerification(db, f.actors.superAdmin, f.projectId)).map((x) => x.id)).toEqual([r.leadId]);
    const told = await db.select().from(notifications).where(and(eq(notifications.type, "lead_verification_requested"), eq(notifications.userId, f.actors.superAdmin.id)));
    expect(told).toHaveLength(1);
  });

  it("leads added by managers and admins need no verification", async () => {
    expect((await leadBy(f.actors.manager)).verification).toBe("approved");
    expect((await leadBy(f.actors.superAdmin)).verification).toBe("approved");
  });

  it("only Admins and Super Admins verify; rejecting needs a reason and goes back to the agent", async () => {
    const r = await leadBy(f.actors.agent1);
    expect(await codeOf(verifyLead(db, f.actors.agent1, r.leadId, { approve: true }))).toBe("FORBIDDEN");
    expect(await codeOf(verifyLead(db, f.actors.superAdmin, r.leadId, { approve: false }))).toBe("VALIDATION_FAILED");
    await verifyLead(db, f.actors.superAdmin, r.leadId, { approve: false, note: "Wrong phone number" });
    expect(await statusOf(r.leadId)).toBe("rejected");
    const [toAgent] = await db.select().from(notifications).where(and(eq(notifications.type, "lead_verified"), eq(notifications.userId, f.actors.agent1.id)));
    expect(toAgent.title).toContain("Lead rejected");

    // The agent corrects the details (allowed while rejected), but can't work on it yet; then resubmits.
    await updateLead(db, f.actors.agent1, r.leadId, { name: "Corrected Name" });
    expect(await codeOf(changeStage(db, f.actors.agent1, r.leadId, { stage: "contact_attempted" }))).toBe("BUSINESS_RULE");
    await resubmitLead(db, f.actors.agent1, r.leadId);
    expect(await statusOf(r.leadId)).toBe("pending");

    await verifyLead(db, f.actors.superAdmin, r.leadId, { approve: true });
    expect(await statusOf(r.leadId)).toBe("approved");
    expect(await codeOf(changeStage(db, f.actors.agent1, r.leadId, { stage: "contact_attempted" }))).toBe("ok");
    expect(await codeOf(verifyLead(db, f.actors.superAdmin, r.leadId, { approve: true }))).toBe("BUSINESS_RULE");
  });
});
