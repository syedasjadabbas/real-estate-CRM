import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { addEmployeeNote, deleteEmployeeNote } from "@/modules/people/notes";
import { employeeProfile } from "@/modules/people/profile";
import { loadActor } from "@/server/auth/session-store";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { followUps, users } from "@/server/db/schema";
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

describe.skipIf(!hasTestDb)("Work profile extras (16 Nov 2026)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [u] = await db.insert(users).values({ name: "Zed Admin", email: "admin@test.local", role: "admin", passwordHash: "x" }).returning();
    admin = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  });

  it("lists overdue follow-ups by lead, sources, the team comparison, the previous period and the daily chart", async () => {
    const a = f.actors.agent1;
    const lead = await createLead(db, a, leadInput(f));
    if (lead.outcome !== "created") throw new Error("setup");
    await db.insert(followUps).values({ leadId: lead.leadId, assigneeId: a.id, dueAt: new Date(Date.now() - 86_400_000), createdById: a.id, note: "Call back" });

    const p = await employeeProfile(db, admin, a.id, {});
    expect(p.overdueList).toEqual([expect.objectContaining({ leadId: lead.leadId, note: "Call back" })]);
    expect(p.bySource).toEqual([expect.objectContaining({ leads: 1, won: 0, lost: 0 })]);
    expect(p.teamCompare).toMatchObject({ team: "Team 1", size: 2, rank: expect.any(Number) });
    expect(p.previous).toMatchObject({ calls: 0, meetings: 0, bookingsMade: 0 });
    expect(p.daily.length).toBeGreaterThan(0);
    expect(p.daily.length).toBeLessThanOrEqual(31);
  });

  it("keeps private coaching notes that only the author or a Super Admin deletes", async () => {
    const a = f.actors.agent1;
    expect((await errorOf(addEmployeeNote(db, a, f.actors.agent2.id, { body: "x" })))?.code).toBe("FORBIDDEN");
    expect((await errorOf(addEmployeeNote(db, admin, a.id, { body: "  " })))?.fields?.body).toMatch(/Write a note/);
    const { id } = await addEmployeeNote(db, admin, a.id, { body: "Spoke about follow-up delays" });
    expect((await employeeProfile(db, admin, a.id, {})).notes).toEqual([expect.objectContaining({ body: "Spoke about follow-up delays", authorName: "Zed Admin" })]);

    const [u] = await db.insert(users).values({ name: "Other Admin", email: "other@test.local", role: "admin", passwordHash: "x" }).returning();
    const other = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    expect((await errorOf(deleteEmployeeNote(db, other, id)))?.code).toBe("FORBIDDEN");
    expect(await deleteEmployeeNote(db, f.actors.superAdmin, id)).toEqual({ deleted: true });
  });
});
