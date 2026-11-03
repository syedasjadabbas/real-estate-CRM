import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUnit } from "@/modules/inventory/commands";
import { importUnits, parseCsv } from "@/modules/inventory/import";
import { auditLogs, units } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

describe("CSV parsing", () => {
  it("handles quotes, escaped quotes, commas, CRLF, a BOM and blank lines", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n1,2')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["1", "2"],
    ]);
  });
});

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

describe.skipIf(!hasTestDb)("Unit import (FR-075)", () => {
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

  const csv = (...lines: string[]) => ["unit_no,floor,area_sqft,base_price,comment", ...lines].join("\n");
  const count = async () => (await db.select({ id: units.id }).from(units).where(eq(units.projectId, f.projectId))).length;

  it("a check reports every row and writes nothing", async () => {
    const r = await importUnits(db, f.actors.superAdmin, { projectId: f.projectId, csv: csv("A-1,1,500,10000000,", 'A-2,2,650,"13,000,000","Corner, sea view"'), apply: false });
    expect(r).toMatchObject({ applied: false, total: 2, valid: 2, failed: 0 });
    expect(await count()).toBe(0);
    expect(await db.select().from(auditLogs)).toEqual([]);
  });

  it("reports bad rows by line (missing area, duplicate in file, existing unit) and imports nothing", async () => {
    await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "OLD-1", areaSqft: "400", basePrice: "1" });
    const r = await importUnits(db, f.actors.superAdmin, { projectId: f.projectId, csv: csv("B-1,1,500,100,", "B-2,1,,100,", "B-1,1,500,100,", "OLD-1,1,500,100,"), apply: true });
    expect(r).toMatchObject({ applied: false, total: 4, valid: 1, failed: 3 });
    expect(r.rows.filter((x) => !x.ok).map((x) => x.line)).toEqual([3, 4, 5]);
    expect(r.rows[1].message).toMatch(/areaSqft/i);
    expect(await count()).toBe(1); // only the earlier OLD-1
  });

  it("imports all rows when the file is clean, each audited, with a summary row", async () => {
    const r = await importUnits(db, f.actors.superAdmin, { projectId: f.projectId, csv: csv("C-1,1,500,10000000,", "C-2,2,650,13000000,"), apply: true });
    expect(r).toMatchObject({ applied: true, valid: 2, failed: 0 });
    const rows = await db.select().from(units).where(eq(units.projectId, f.projectId));
    expect(rows.map((u) => [u.unitNo, u.status, u.areaSqft]).sort()).toEqual([
      ["C-1", "available", 500],
      ["C-2", "available", 650],
    ]);
    const actions = (await db.select({ a: auditLogs.action }).from(auditLogs)).map((x) => x.a);
    expect(actions.filter((a) => a === "unit.create")).toHaveLength(2);
    expect(actions).toContain("unit.import");
  });

  it("refuses bad headers, empty files and roles without inventory management", async () => {
    expect(await errorCode(importUnits(db, f.actors.superAdmin, { projectId: f.projectId, csv: "unit,area\nA,1", apply: false }))).toBe("VALIDATION_FAILED");
    expect(await errorCode(importUnits(db, f.actors.superAdmin, { projectId: f.projectId, csv: "unit_no,area_sqft,base_price", apply: false }))).toBe("VALIDATION_FAILED");
    for (const actor of [f.actors.manager, f.actors.agent1, f.actors.hr]) {
      expect(await errorCode(importUnits(db, actor, { projectId: f.projectId, csv: csv("D-1,1,500,1,"), apply: true })), actor.role).toBe("FORBIDDEN");
    }
  });
});
