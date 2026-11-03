import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addCategory, attachEntryFile, createEntry, getEntry, incomeExpenseByMonth, listEntries, listEntryFiles, openEntryFile, setCategoryActive, updateEntry, voidEntry } from "@/modules/finance/entries";
import { listPaymentMethods } from "@/modules/finance/queries";
import { exportReport } from "@/modules/finance/reports";
import { openDocument } from "@/modules/documents/service";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, financeEntries, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor, Role } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
};
const errorCode = async (p: Promise<unknown>) => (await errorOf(p))?.code ?? "ok";
const pdf = () => {
  const b = new Uint8Array(256);
  b.set(new TextEncoder().encode("%PDF-1.7\n"));
  return b;
};

describe.skipIf(!hasTestDb)("Income and expenses (FR-200, FR-201, FR-205)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let accountant: Actor;
  let admin: Actor;
  let rent: string;
  let commission: string;
  let cashId: string;
  let storageDir: string;

  beforeAll(async () => {
    ({ db, close } = connectTestDb());
    storageDir = await mkdtemp(path.join(tmpdir(), "mz-entries-"));
    process.env.FILE_STORAGE_DIR = storageDir;
  });
  afterAll(async () => {
    delete process.env.FILE_STORAGE_DIR;
    await close();
    await rm(storageDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const make = async (name: string, email: string, role: Role) => {
      const [u] = await db.insert(users).values({ name, email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    accountant = await make("Accountant", "acc@test.local", "accountant");
    admin = await make("Admin", "admin@test.local", "admin");
    rent = (await addCategory(db, f.actors.superAdmin, { kind: "expense", name: "Office rent" })).categoryId;
    commission = (await addCategory(db, f.actors.superAdmin, { kind: "income", name: "Commission" })).categoryId;
    cashId = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash")!.id;
  });

  it("categories: only Super Admin manages them; names are unique per kind; deactivated ones can't be used", async () => {
    expect(await errorCode(addCategory(db, accountant, { kind: "income", name: "X" }))).toBe("FORBIDDEN");
    expect(await errorCode(addCategory(db, admin, { kind: "income", name: "X" }))).toBe("FORBIDDEN");
    expect((await errorOf(addCategory(db, f.actors.superAdmin, { kind: "expense", name: "office RENT" })))?.fields?.name).toMatch(/exists/);
    expect(await errorCode(addCategory(db, f.actors.superAdmin, { kind: "income", name: "Office rent" }))).toBe("ok");
    await setCategoryActive(db, f.actors.superAdmin, rent, false);
    expect((await errorOf(createEntry(db, accountant, { kind: "expense", categoryId: rent, amount: "1000", entryDate: "2026-11-01" })))?.fields?.categoryId).toBeTruthy();
  });

  it("an accountant records income and expenses; admins view but can't record; others are refused", async () => {
    const { entryId } = await createEntry(db, accountant, { kind: "expense", categoryId: rent, amount: "150,000", entryDate: "2026-11-01", methodId: cashId, payee: "Landlord", reference: "NOV" });
    await createEntry(db, accountant, { kind: "income", categoryId: commission, amount: "400000", entryDate: "2026-11-02" });
    // Category kind must match; payee is for expenses only; amounts must be positive.
    expect((await errorOf(createEntry(db, accountant, { kind: "income", categoryId: rent, amount: "1", entryDate: "2026-11-01" })))?.fields?.categoryId).toBeTruthy();
    expect((await errorOf(createEntry(db, accountant, { kind: "income", categoryId: commission, amount: "1", entryDate: "2026-11-01", payee: "X" })))?.fields?.payee).toBeTruthy();
    expect(await errorCode(createEntry(db, accountant, { kind: "income", categoryId: commission, amount: "0", entryDate: "2026-11-01" }))).toBe("VALIDATION_FAILED");

    expect(await errorCode(createEntry(db, admin, { kind: "income", categoryId: commission, amount: "1", entryDate: "2026-11-01" }))).toBe("FORBIDDEN");
    expect((await listEntries(db, admin, {})).totals).toEqual({ income: 400000, expense: 150000, net: 250000 });
    for (const actor of [f.actors.manager, f.actors.agent1, f.actors.hr]) {
      expect(await errorCode(listEntries(db, actor, {})), actor.role).toBe("FORBIDDEN");
      expect(await errorCode(getEntry(db, actor, entryId)), actor.role).toBe("FORBIDDEN");
    }
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, entryId));
    expect(log.action).toBe("finance.expense_create");
  });

  it("totals cover every matching entry across pages, not just the page shown; search narrows both", async () => {
    // 60 expenses of 1,000.01 directly in the table (faster than the service), plus one income and one voided expense.
    await db.insert(financeEntries).values(
      Array.from({ length: 60 }, (_, i) => ({ kind: "expense" as const, categoryId: rent, amount: 1000.01, entryDate: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, payee: i < 5 ? "Electric Co" : "Landlord", createdById: accountant.id })),
    );
    await createEntry(db, accountant, { kind: "income", categoryId: commission, amount: "500000", entryDate: "2026-10-05", reference: "INV-77" });
    const { entryId } = await createEntry(db, accountant, { kind: "expense", categoryId: rent, amount: "99999", entryDate: "2026-10-06" });
    await voidEntry(db, accountant, entryId, { reason: "Entered twice" });

    const first = await listEntries(db, admin, {});
    expect(first).toMatchObject({ total: 61, page: 1, pageCount: 2 });
    expect(first.rows).toHaveLength(50);
    expect(first.totals).toEqual({ income: 500000, expense: 60000.6, net: 439999.4 });
    const second = await listEntries(db, admin, { page: "2" });
    expect(second.rows).toHaveLength(11);
    expect(second.totals).toEqual(first.totals);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(61);
    // A page past the end clamps to the last page.
    expect((await listEntries(db, admin, { page: "9" })).page).toBe(2);

    // Listing voided entries never adds them to totals.
    expect((await listEntries(db, admin, { voided: "include" })).totals).toEqual(first.totals);
    // Search: payee, reference, category name.
    expect((await listEntries(db, admin, { q: "electric" })).totals).toEqual({ income: 0, expense: 5000.05, net: -5000.05 });
    expect((await listEntries(db, admin, { q: "INV-77" })).rows.map((r) => r.kind)).toEqual(["income"]);
    expect((await listEntries(db, admin, { q: "commission" })).total).toBe(1);
    expect((await listEntries(db, admin, { q: "100%_" })).total).toBe(0);
  });

  it("edits are audited before / after; voiding keeps the entry, leaves totals and blocks edits", async () => {
    const { entryId } = await createEntry(db, accountant, { kind: "expense", categoryId: rent, amount: "150000", entryDate: "2026-11-01" });
    expect(await updateEntry(db, accountant, entryId, { amount: "160000", payee: "Landlord" })).toEqual({ changed: ["amount", "payee"] });
    const trail = (await getEntry(db, admin, entryId)).trail;
    expect(trail[0]).toMatchObject({ action: "finance.expense_update", before: { amount: 150000, payee: null }, after: { amount: 160000, payee: "Landlord" } });

    expect(await errorCode(voidEntry(db, accountant, entryId, { reason: "no" }))).toBe("VALIDATION_FAILED");
    await voidEntry(db, accountant, entryId, { reason: "Entered twice" });
    const [row] = await db.select().from(financeEntries).where(eq(financeEntries.id, entryId));
    expect(row).toMatchObject({ amount: 160000, voidReason: "Entered twice" });
    expect((await listEntries(db, admin, {})).rows).toEqual([]);
    expect((await listEntries(db, admin, { voided: "include" })).rows).toHaveLength(1);
    expect(await errorCode(updateEntry(db, accountant, entryId, { amount: "1" }))).toBe("BUSINESS_RULE");
    expect(await errorCode(voidEntry(db, accountant, entryId, { reason: "Again please" }))).toBe("BUSINESS_RULE");
  });

  it("attachments are private: finance view roles open them; other roles and the lead document route can't", async () => {
    const { entryId } = await createEntry(db, accountant, { kind: "expense", categoryId: rent, amount: "1000", entryDate: "2026-11-01" });
    expect(await errorCode(attachEntryFile(db, admin, entryId, { bytes: pdf(), name: "bill.pdf" }))).toBe("FORBIDDEN");
    const { id } = await attachEntryFile(db, accountant, entryId, { bytes: pdf(), name: "bill.pdf" });
    expect((await listEntryFiles(db, admin, entryId)).map((x) => x.name)).toEqual(["bill.pdf"]);
    expect(await errorCode(openEntryFile(db, admin, id))).toBe("ok");
    for (const actor of [f.actors.manager, f.actors.agent1, f.actors.hr]) expect(await errorCode(openEntryFile(db, actor, id)), actor.role).toBe("FORBIDDEN");
    expect(await errorCode(openDocument(db, f.actors.superAdmin, id))).toBe("NOT_FOUND");
    expect(await errorCode(attachEntryFile(db, accountant, entryId, { bytes: pdf(), name: "bill.jpg" }))).toBe("VALIDATION_FAILED");
  });

  it("FR-205: income vs expense by month for a year, voided entries excluded, with an audited CSV", async () => {
    await createEntry(db, accountant, { kind: "income", categoryId: commission, amount: "400000", entryDate: "2026-01-15" });
    await createEntry(db, accountant, { kind: "expense", categoryId: rent, amount: "150000", entryDate: "2026-01-20" });
    await createEntry(db, accountant, { kind: "expense", categoryId: rent, amount: "150000", entryDate: "2026-03-01" });
    const { entryId: voided } = await createEntry(db, accountant, { kind: "income", categoryId: commission, amount: "999", entryDate: "2026-03-02" });
    await voidEntry(db, accountant, voided, { reason: "Wrong entry" });
    await createEntry(db, accountant, { kind: "income", categoryId: commission, amount: "5", entryDate: "2025-12-31" });
    const r = await incomeExpenseByMonth(db, admin, { year: "2026" });
    expect(r.months[0]).toEqual({ month: "2026-01", income: 400000, expense: 150000, net: 250000 });
    expect(r.months[2]).toEqual({ month: "2026-03", income: 0, expense: 150000, net: -150000 });
    expect(r.totals).toEqual({ income: 400000, expense: 300000, net: 100000 });
    const csv = await exportReport(db, accountant, { report: "income_expense", year: "2026" });
    expect(csv.filename).toBe("income-vs-expense-2026.csv");
    expect(csv.body.trim().split("\n").at(-1)).toBe("Total,400000,300000,100000");
    expect(await errorCode(incomeExpenseByMonth(db, f.actors.manager, {}))).toBe("FORBIDDEN");
  });
});
