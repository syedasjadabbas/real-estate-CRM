import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { performanceReport } from "@/modules/performance/service";
import { listWhatsapp, openWhatsapp, uploadWhatsapp } from "@/modules/whatsapp/service";
import type { Database } from "@/server/db";
import { auditLogs, leadActivities, leads } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const TEXT = new TextEncoder().encode("this is not a picture at all");

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
};

describe.skipIf(!hasTestDb)("WhatsApp call and chat screenshots (owner, 18 Nov 2026)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let leadId: string;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const r = await createLead(db, f.actors.superAdmin, leadInput(f, { ownerId: f.actors.agent1.id }));
    if (r.outcome !== "created") throw new Error("setup");
    leadId = r.leadId;
  });

  const range = () => {
    const today = new Date().toISOString().slice(0, 10);
    return { from: today, to: today };
  };

  it("a WhatsApp call screenshot counts as a call with the length the agent enters; a chat doesn't", async () => {
    const before = (await performanceReport(db, f.actors.superAdmin, range())).allRows.find((r) => r.userId === f.actors.agent1.id)!;
    await uploadWhatsapp(db, f.actors.agent1, leadId, { kind: "whatsapp_call", bytes: PNG, name: "call.png", length: "3:25" });
    await uploadWhatsapp(db, f.actors.agent1, leadId, { kind: "whatsapp_chat", bytes: PNG, name: "chat.png" });
    const after = (await performanceReport(db, f.actors.superAdmin, range())).allRows.find((r) => r.userId === f.actors.agent1.id)!;
    expect(after.calls - before.calls).toBe(1);
    expect(after.callSeconds - before.callSeconds).toBe(205);
    expect(after.callsQualified - before.callsQualified).toBe(1);

    const rows = await listWhatsapp(db, f.actors.agent1, leadId);
    expect(rows.map((r) => [r.kind, r.durationSec])).toEqual(
      expect.arrayContaining([
        ["whatsapp_call", 205],
        ["whatsapp_chat", null],
      ]),
    );
    const types = await db.select({ data: leadActivities.data }).from(leadActivities).where(eq(leadActivities.leadId, leadId));
    expect(types.map((t) => (t.data as { kind?: string }).kind).filter(Boolean).sort()).toEqual(["whatsapp_call", "whatsapp_chat"]);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "lead.whatsapp_call_upload"))).length).toBe(1);
  });

  it("a chat screenshot marks an untouched lead as contacted (first touch)", async () => {
    const [{ firstTouchAt }] = await db.select({ firstTouchAt: leads.firstTouchAt }).from(leads).where(eq(leads.id, leadId));
    expect(firstTouchAt).toBeNull();
    await uploadWhatsapp(db, f.actors.agent1, leadId, { kind: "whatsapp_chat", bytes: PNG, name: "chat.png" });
    const [after] = await db.select({ firstTouchAt: leads.firstTouchAt }).from(leads).where(eq(leads.id, leadId));
    expect(after.firstTouchAt).not.toBeNull();
  });

  it("checks the picture and the call length; only people who can see the lead open it", async () => {
    expect((await errorOf(uploadWhatsapp(db, f.actors.agent1, leadId, { kind: "whatsapp_chat", bytes: TEXT, name: "x.png" })))?.fields?.file).toMatch(/JPG, PNG or WebP/);
    expect((await errorOf(uploadWhatsapp(db, f.actors.agent1, leadId, { kind: "whatsapp_call", bytes: PNG, name: "x.png", length: "" })))?.fields?.length).toMatch(/call length/);
    expect((await errorOf(uploadWhatsapp(db, f.actors.agent1, leadId, { kind: "whatsapp_call", bytes: PNG, name: "x.png", length: "abc" })))?.fields?.length).toMatch(/minutes:seconds/);
    // Another agent can't add to (or open) someone else's lead.
    expect((await errorOf(uploadWhatsapp(db, f.actors.agent2, leadId, { kind: "whatsapp_chat", bytes: PNG, name: "x.png" })))?.code).toBe("NOT_FOUND");
    const up = await uploadWhatsapp(db, f.actors.agent1, leadId, { kind: "whatsapp_call", bytes: PNG, name: "c.png", length: "75" });
    expect((await openWhatsapp(db, f.actors.superAdmin, up.id)).durationSec).toBe(75);
    expect((await errorOf(openWhatsapp(db, f.actors.agent2, up.id)))?.code).toBe("NOT_FOUND");
  });
});
