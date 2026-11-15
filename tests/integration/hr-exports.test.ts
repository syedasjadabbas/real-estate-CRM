import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkIn, checkOut } from "@/modules/attendance/service";
import { instantOf } from "@/modules/attendance/rules";
import { hrExport } from "@/modules/hr/exports";
import { submitLeave } from "@/modules/leave/service";
import { auditLogs, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { toCsv } from "@/server/csv";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};
const lines = (body: string) => body.replace(/^﻿/, "").trim().split("\r\n");

describe("CSV helper", () => {
  it("starts with a byte-order mark, quotes where needed and defuses formulas", () => {
    const body = toCsv(["Name", "Note"], [["Ali, Khan", '=HYPERLINK("x")'], ["سارہ", null]]);
    expect(body.startsWith("﻿")).toBe(true);
    expect(lines(body)).toEqual(["Name,Note", '"Ali, Khan","\'=HYPERLINK(""x"")"', "سارہ,"]);
  });
});

describe.skipIf(!hasTestDb)("HR CSV downloads (15 Nov 2026)", () => {
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
    await db.update(users).set({ createdAt: new Date("2026-10-01T00:00:00+05:00") });
  });

  it("only HR, Admins and Super Admins download, and every download is audited", async () => {
    for (const actor of [f.actors.agent1, f.actors.manager]) expect(await errorCode(hrExport(db, actor, "employees", {}))).toBe("FORBIDDEN");
    expect(await errorCode(hrExport(db, f.actors.hr, "salaries", {}))).toBe("VALIDATION_FAILED");
    const file = await hrExport(db, f.actors.hr, "employees", { q: "Agent" });
    expect(file.filename).toMatch(/^employees-\d{4}-\d{2}-\d{2}\.csv$/);
    const [header, ...rest] = lines(file.body);
    expect(header).toBe("Name,Email,Role,Designation,Department,Phone,Joining date,Account");
    expect(rest.length).toBe(file.rows);
    expect(rest.every((l) => l.includes("Sales Agent"))).toBe(true);
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "hr.export"));
    expect(log).toMatchObject({ actorId: f.actors.hr.id, entityId: "employees" });
    expect(log.after).toMatchObject({ filters: { q: "Agent" }, rows: file.rows });
  });

  it("downloads leave requests and balances for the year", async () => {
    const year = new Date().getFullYear();
    await submitLeave(db, f.actors.agent1, { type: "annual", startDate: `${year}-12-01`, endDate: `${year}-12-02`, reason: "Family" });
    const leave = await hrExport(db, f.actors.superAdmin, "leave", { year: String(year) });
    expect(lines(leave.body)[1]).toMatch(new RegExp(`^${f.actors.agent1.name},Sales Agent,Annual,${year}-12-01,${year}-12-02,2,Pending,Family,`));
    const balances = await hrExport(db, f.actors.superAdmin, "leave-balances", { year: String(year) });
    expect(balances.body).toContain(`${f.actors.agent1.name},Sales Agent,${year},30,0,2,28,0`);
  });

  it("downloads the attendance day sheet and monthly summary", async () => {
    await checkIn(db, f.actors.agent1, instantOf("2026-11-02", "09:30"));
    await checkOut(db, f.actors.agent1, instantOf("2026-11-02", "17:30"));
    const day = await hrExport(db, f.actors.hr, "attendance-day", { date: "2026-11-02" });
    expect(day.filename).toBe("attendance-2026-11-02.csv");
    expect(day.body).toContain(`${f.actors.agent1.name},Sales Agent,2026-11-02,Late,09:30,17:30,8h 00m,,`);
    const month = await hrExport(db, f.actors.hr, "attendance-month", { month: "2026-11" });
    expect(month.filename).toBe("attendance-2026-11.csv");
    expect(lines(month.body)[0]).toBe("Employee,Role,Month,Working days,Present (incl. late),Late,Absent,On leave,Holidays,Hours worked,Missing check-outs");
  });
});
