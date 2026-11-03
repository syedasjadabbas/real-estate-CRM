import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUnit } from "@/modules/inventory/commands";
import { CsvFormatError, importUnits, parseCsv, parseCsvRows } from "@/modules/inventory/import";
import { hashPassword } from "@/server/auth/password";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, units, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Role } from "@/server/auth/types";
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

  it("keeps each row's file line across blank lines and line breaks inside quotes", () => {
    expect(parseCsvRows('h1,h2\n\na,"two\nlines"\r\nb,c\n')).toEqual([
      { line: 1, cells: ["h1", "h2"] },
      { line: 3, cells: ["a", "two\nlines"] },
      { line: 5, cells: ["b", "c"] },
    ]);
  });

  it("refuses an unclosed quote instead of swallowing the rest of the file", () => {
    expect(() => parseCsv('a,b\n1,"open\n2,3')).toThrow(CsvFormatError);
    try {
      parseCsv('a,b\n1,2\n3,"open');
    } catch (e) {
      expect((e as CsvFormatError).line).toBe(3);
    }
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

  const createdAudits = async () => (await db.select({ a: auditLogs.action }).from(auditLogs)).filter((x) => x.a === "unit.create" || x.a === "unit.import").length;

  it("refuses malformed files: an unclosed quote, and rows with more values than columns", async () => {
    expect(await errorCode(importUnits(db, f.actors.superAdmin, { projectId: f.projectId, csv: csv('E-1,1,500,100,"never closed'), apply: true }))).toBe("VALIDATION_FAILED");
    // An unquoted comma in the price spills into extra columns: reported, not silently dropped.
    const r = await importUnits(db, f.actors.superAdmin, { projectId: f.projectId, csv: csv("E-2,1,500,13,000,000,note", "E-3,1,500,100,,"), apply: true });
    expect(r).toMatchObject({ applied: false, failed: 1, valid: 1 });
    expect(r.rows[0]).toMatchObject({ line: 2, unitNo: "E-2", ok: false });
    expect(r.rows[0].message).toMatch(/7 values but the header has 5 columns/);
    expect(await count()).toBe(0);
  });

  it("validates numbers, decimals, dates and required fields per row", async () => {
    const header = "unit_no,area_sqft,base_price,bedrooms,listed_on";
    const file = [
      header,
      "N-1,abc,100,,", // area not a number
      "N-2,-5,100,,", // negative area
      "N-3,0,100,,", // zero area
      "N-4,500,12.345,,", // 3 decimals
      "N-5,500,-1,,", // negative price
      "N-6,500,100,2.5,", // fractional bedrooms
      "N-7,500,100,,2026-13-01", // invalid date
      ",500,100,,", // missing unit number
      "N-9,500,,,", // missing price
      'N-10,"1,250.50","13,000,000.25",3,2026-11-03', // valid: thousands separators and 2 decimals
    ].join("\n");
    const r = await importUnits(db, f.actors.superAdmin, { projectId: f.projectId, csv: file, apply: false });
    const msg = (line: number) => r.rows.find((x) => x.line === line)!.message ?? "";
    expect(r).toMatchObject({ total: 10, valid: 1, failed: 9 });
    expect(msg(2)).toMatch(/areaSqft: Area must be a number/);
    expect(msg(3)).toMatch(/areaSqft: Area must be greater than 0/);
    expect(msg(4)).toMatch(/areaSqft: Area must be greater than 0/);
    expect(msg(5)).toMatch(/basePrice: Use at most 2 decimals/);
    expect(msg(6)).toMatch(/basePrice: Base price cannot be negative/);
    expect(msg(7)).toMatch(/bedrooms/);
    expect(msg(8)).toMatch(/listedOn/);
    expect(msg(9)).toMatch(/unitNo/);
    expect(msg(10)).toMatch(/basePrice: Base price is required/);
    expect(r.rows.find((x) => x.line === 11)).toMatchObject({ unitNo: "N-10", ok: true });
  });

  it("treats unit numbers case-insensitively, in the file and against existing units", async () => {
    await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "OLD-2", areaSqft: "400", basePrice: "1" });
    const r = await importUnits(db, f.actors.superAdmin, { projectId: f.projectId, csv: csv("dup-1,1,500,100,", "DUP-1,1,500,100,", "old-2,1,500,100,"), apply: false });
    expect(r.rows.map((x) => x.ok)).toEqual([true, false, false]);
    expect(r.rows[1].message).toMatch(/already exists/);
    expect(r.rows[2].message).toMatch(/already exists/);
  });

  it("rolls back every earlier valid row when a later row fails, with no audit rows", async () => {
    const before = await createdAudits();
    const r = await importUnits(db, f.actors.superAdmin, { projectId: f.projectId, csv: csv("R-1,1,500,100,", "R-2,1,500,100,", "R-3,1,,100,"), apply: true });
    expect(r).toMatchObject({ applied: false, valid: 2, failed: 1 });
    expect(await count()).toBe(0);
    expect(await createdAudits()).toBe(before);
  });

  it("allows the roles that add units by hand (super admin, admin) and refuses the accountant", async () => {
    const make = async (email: string, role: Role) => {
      const [u] = await db.insert(users).values({ name: role, email, role, passwordHash: await hashPassword("x-y-z-w-v") }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    const admin = await make("admin@test.local", "admin");
    const accountant = await make("acc@test.local", "accountant");
    expect(await errorCode(importUnits(db, admin, { projectId: f.projectId, csv: csv("P-1,1,500,1,"), apply: true }))).toBe("ok");
    expect(await count()).toBe(1);
    for (const actor of [accountant, f.actors.outsideAgent]) {
      expect(await errorCode(importUnits(db, actor, { projectId: f.projectId, csv: csv("P-2,1,500,1,"), apply: true })), actor.role).toBe("FORBIDDEN");
    }
    expect(await count()).toBe(1);
  });

  it("records who imported, how many units, and each unit's creation", async () => {
    await importUnits(db, f.actors.superAdmin, { projectId: f.projectId, csv: csv("H-1,1,500,100,", "H-2,1,500,100,", "H-3,1,500,100,"), apply: true });
    const [summary] = await db.select().from(auditLogs).where(eq(auditLogs.action, "unit.import"));
    expect(summary).toMatchObject({ actorId: f.actors.superAdmin.id, entity: "project", entityId: f.projectId, after: { created: 3 } });
    const created = await db.select().from(auditLogs).where(eq(auditLogs.action, "unit.create"));
    expect(created).toHaveLength(3);
    expect(created.every((a) => a.actorId === f.actors.superAdmin.id)).toBe(true);
  });
});
