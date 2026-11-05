import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SORTABLE_COLUMNS } from "@/modules/leads/constants";
import { createLead } from "@/modules/leads/commands";
import { getLeadDetail, listLeads } from "@/modules/leads/queries";
import { leads } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe.skipIf(!hasTestDb)("FR-022: lead table columns and sorting (PostgreSQL integration)", () => {
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
    const now = Date.now();
    /** `touchHours` is how long after creation the first touch came. */
    const make = async (name: string, values: Partial<typeof leads.$inferInsert>, touchHours?: number) => {
      const r = await createLead(db, f.actors.agent1, leadInput(f, { name: `Lead ${name}` }));
      if (r.outcome !== "created") throw new Error("setup");
      const [row] = await db.select().from(leads).where(eq(leads.id, r.leadId));
      const firstTouchAt = touchHours === undefined ? null : new Date(row.createdAt.getTime() + touchHours * HOUR);
      await db.update(leads).set({ ...values, firstTouchAt }).where(eq(leads.id, r.leadId));
    };
    await make("A", {
      code: "AAAAAAAA",
      gender: "female",
      desiredSize: "674 sq ft",
      latestComment: "alpha",
      inboundChannel: "manual",
      externalId: "EXT-2",
      stageChangedAt: new Date(now - 3 * DAY),
      updatedAt: new Date(now - DAY),
      nextFollowUpAt: new Date(now + DAY),
    }, 1);
    await make("B", {
      code: "BBBBBBBB",
      gender: "Male",
      desiredSize: "1,200 sq ft",
      latestComment: "Beta",
      inboundChannel: "meta",
      externalId: "EXT-1",
      lostReasonId: f.lostReasonId,
      stageChangedAt: new Date(now - DAY),
      updatedAt: new Date(now - 3 * DAY),
      nextFollowUpAt: new Date(now + 3 * DAY),
    }, 3);
    await make("C", {
      code: "CCCCCCCC",
      inboundChannel: "tiktok",
      stageChangedAt: new Date(now - 2 * DAY),
      updatedAt: new Date(now - 2 * DAY),
    });
  });

  const names = async (sort: string, dir: "asc" | "desc") => (await listLeads(db, f.actors.superAdmin, f.projectId, { sort, dir })).rows.map((r) => r.name.replace("Lead ", ""));

  it.each([
    ["code", ["A", "B", "C"], ["C", "B", "A"]],
    ["inStage", ["B", "C", "A"], ["A", "C", "B"]],
    ["modified", ["B", "C", "A"], ["A", "C", "B"]],
    ["firstTouch", ["A", "B", "C"], ["B", "A", "C"]],
    ["next", ["A", "B", "C"], ["B", "A", "C"]],
    ["inbound", ["A", "B", "C"], ["C", "B", "A"]],
    ["size", ["A", "B", "C"], ["B", "A", "C"]],
    ["gender", ["A", "B", "C"], ["B", "A", "C"]],
    ["comment", ["A", "B", "C"], ["B", "A", "C"]],
    ["externalId", ["B", "A", "C"], ["A", "B", "C"]],
  ])("sorts by %s both ways, with blanks last", async (sort, asc, desc) => {
    expect(await names(sort, "asc")).toEqual(asc);
    expect(await names(sort, "desc")).toEqual(desc);
  });

  it("sorts by lost reason, with blanks last", async () => {
    expect((await names("lostReason", "asc"))[0]).toBe("B");
    expect((await names("lostReason", "desc"))[0]).toBe("B");
  });

  it("every sortable column runs", async () => {
    for (const sort of SORTABLE_COLUMNS) {
      for (const dir of ["asc", "desc"] as const) expect(await names(sort, dir)).toHaveLength(3);
    }
  });

  it("size sorts by number, not as text, and text with no number goes last", async () => {
    await db.update(leads).set({ desiredSize: "large" }).where(eq(leads.code, "CCCCCCCC"));
    expect(await names("size", "asc")).toEqual(["A", "B", "C"]);
    expect(await names("size", "desc")).toEqual(["B", "A", "C"]);
  });

  // Values that differ only in letter case must tie, whatever the database's collation. A tie falls
  // back to newest first in both directions; a case-sensitive sort would flip with the direction.
  it.each([
    ["gender", "gender", "female", "FEMALE"],
    ["comment", "latestComment", "same note", "SAME NOTE"],
  ] as const)("%s values that differ only in letter case tie in both directions", async (sort, column, lower, upper) => {
    const now = Date.now();
    await db.update(leads).set({ [column]: lower, createdAt: new Date(now - 2 * HOUR) }).where(eq(leads.code, "AAAAAAAA"));
    await db.update(leads).set({ [column]: upper, createdAt: new Date(now - HOUR) }).where(eq(leads.code, "BBBBBBBB"));
    expect(await names(sort, "asc")).toEqual(["B", "A", "C"]);
    expect(await names(sort, "desc")).toEqual(["B", "A", "C"]);
  });

  it("an unknown sort falls back to the default instead of failing", async () => {
    expect(await names("password_hash", "asc")).toHaveLength(3);
    expect(await names("name; drop table leads", "desc")).toHaveLength(3);
  });

  it("rows carry the new columns, and blanks stay blank", async () => {
    const { rows } = await listLeads(db, f.actors.superAdmin, f.projectId, { sort: "code", dir: "asc" });
    expect(rows[0]).toMatchObject({ gender: "female", externalId: "EXT-2", inboundChannel: "manual", lostReasonName: null });
    expect(rows[1]).toMatchObject({ gender: "Male", externalId: "EXT-1", inboundChannel: "meta" });
    expect(rows[1].lostReasonName).toBeTruthy();
    expect(rows[2]).toMatchObject({ gender: null, externalId: null, inboundChannel: "tiktok", lostReasonName: null });
  });

  it("the lead detail still loads through the shared selection", async () => {
    const { rows } = await listLeads(db, f.actors.superAdmin, f.projectId, { sort: "code", dir: "asc" });
    const { lead } = await getLeadDetail(db, f.actors.superAdmin, rows[1].id);
    expect(lead.lostReason).toBeTruthy();
    expect(lead.lostReasonName).toBe(lead.lostReason);
  });

  it("sorting keeps record scope", async () => {
    const own = await listLeads(db, f.actors.agent2, f.projectId, { sort: "lostReason", dir: "asc" });
    expect(own.rows).toEqual([]);
    expect((await listLeads(db, f.actors.agent1, f.projectId, { sort: "externalId", dir: "asc" })).rows).toHaveLength(3);
  });
});
