import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceBooking, cancelBooking, createBooking } from "@/modules/bookings/commands";
import { decideReversal, recordPayment, requestReversal } from "@/modules/finance/commands";
import { addCategory, createEntry, listEntries, voidEntry } from "@/modules/finance/entries";
import { netPaid } from "@/modules/finance/ledger";
import { listPaymentMethods, listPayments } from "@/modules/finance/queries";
import { collectionsByProject, outstandingBy } from "@/modules/finance/reports";
import { listOutstanding, outstandingBookings } from "@/modules/finance/views";
import { createUnit } from "@/modules/inventory/commands";
import { listUnits } from "@/modules/inventory/queries";
import { createLead } from "@/modules/leads/commands";
import { loadActor } from "@/server/auth/session-store";
import { bookings, projects, taskInstallmentRows, tasks, units, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};
const TODAY = "2026-11-05";
type Key = string | number | boolean | number[] | null;

const compare = (x: Exclude<Key, null>, y: Exclude<Key, null>): number => {
  if (Array.isArray(x)) {
    const other = y as number[];
    return x[0] - other[0] || x[1] - other[1];
  }
  if (typeof x === "string") return x.toLowerCase().localeCompare(String(y).toLowerCase());
  return Number(x) - Number(y);
};
/** What the database must return: a stable sort of the default order, blanks last in either direction. */
const expected = <T>(rows: T[], key: (r: T) => Key, dir: "asc" | "desc") =>
  rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
      const c = compare(a.k, b.k);
      return c !== 0 ? (dir === "asc" ? c : -c) : a.i - b.i;
    })
    .map((x) => x.r);
const blank = (v: string | null) => (v && v.trim() ? v.trim() : null);

describe.skipIf(!hasTestDb)("F-16: column sorting on Inventory and Finance lists (FR-005, PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let accountant: Actor;
  let admin: Actor;
  let cashId: string;
  let bankId: string;
  let unitCounter = 0;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const make = async (name: string, email: string, role: "admin" | "accountant") => {
      const [u] = await db.insert(users).values({ name, email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    accountant = await make("Acc", "acc@test.local", "accountant");
    admin = await make("Zed Admin", "admin@test.local", "admin");
    const methods = await listPaymentMethods(db, { activeOnly: true });
    cashId = methods.find((m) => m.name === "Cash")!.id;
    bankId = methods.find((m) => m.name !== "Cash")!.id;
  });

  /** All rows of a paged list, walking every page. */
  const walk = async <R>(list: (query: Record<string, string>) => Promise<{ rows: R[]; pageCount: number }>, query: Record<string, string> = {}) => {
    const first = await list(query);
    const rows = [...first.rows];
    for (let page = 2; page <= first.pageCount; page += 1) rows.push(...(await list({ ...query, page: String(page) })).rows);
    return rows;
  };
  const bookingFor = async (owner: Actor = f.actors.agent1, stages: string[] = ["token_pending"], area = "500", name = "Test Lead") => {
    unitCounter += 1;
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: `S-${String(unitCounter).padStart(3, "0")}`, areaSqft: area, basePrice: "1000000" });
    const lead = await createLead(db, f.actors.superAdmin, leadInput(f, { ownerId: owner.id, name }));
    if (lead.outcome !== "created") throw new Error("lead");
    const { bookingId } = await createBooking(db, f.actors.superAdmin, { projectId: f.projectId, leadId: lead.leadId, unitId, ratePerSqft: "1000", tokenAmount: "1000" });
    for (const toStage of stages) await advanceBooking(db, f.actors.superAdmin, bookingId, { toStage });
    return bookingId;
  };
  const pay = (bookingId: string, amount: string, extra: Record<string, unknown> = {}) => recordPayment(db, accountant, { bookingId, type: "token", amount, receivedOn: TODAY, methodId: cashId, ...extra });
  const reverse = async (paymentId: string) => {
    const { requestId } = await requestReversal(db, accountant, paymentId, { reason: "Entered against the wrong booking" });
    await decideReversal(db, admin, requestId, { approve: true });
  };

  describe("Inventory", () => {
    const list = (q: Record<string, string>) => listUnits(db, f.actors.superAdmin, { project: "all", ...q }, null);
    const seedUnits = async () => {
      await db.insert(units).values([
        { projectId: f.projectId, unitNo: "A1", floor: "GF", areaSqft: 500, basePrice: 300, saleModel: "whole", nature: "Shop", category: "Retail", type: "Corner", bedrooms: 2, listedOn: "2026-01-05", status: "available" },
        { projectId: f.projectId, unitNo: "a2", floor: "gf", areaSqft: 700, basePrice: 100, saleModel: "spu", nature: "shop", category: null, type: "   ", bedrooms: null, listedOn: null, status: "reserved" },
        { projectId: f.otherProjectId, unitNo: "B1", floor: null, areaSqft: 500, basePrice: 200, saleModel: "fractional_50", nature: null, category: "Office", type: "Studio", bedrooms: 1, listedOn: "2026-03-01", status: "sold" },
        { projectId: f.otherProjectId, unitNo: "C1", floor: "  ", areaSqft: 900, basePrice: 300, saleModel: "whole", nature: "Flat", category: "", type: null, bedrooms: 3, listedOn: "2026-02-01", status: "available" },
      ]);
    };
    type Row = Awaited<ReturnType<typeof listUnits>>["rows"][number];
    const KEYS: Record<string, (r: Row) => Key> = {
      project: (r) => r.projectName,
      floor: (r) => blank(r.floor),
      unit: (r) => r.unitNo,
      saleModel: (r) => r.saleModel,
      area: (r) => r.areaSqft,
      price: (r) => r.basePrice,
      nature: (r) => blank(r.nature),
      category: (r) => blank(r.category),
      status: (r) => r.status,
      type: (r) => blank(r.type),
      bedrooms: (r) => r.bedrooms,
      listedOn: (r) => r.listedOn,
    };

    it("sorts every column both ways, with nulls and blanks last and ties in the default order", async () => {
      await seedUnits();
      const base = await walk(list);
      for (const [sort, key] of Object.entries(KEYS)) {
        for (const dir of ["asc", "desc"] as const) {
          expect((await walk(list, { sort, dir })).map((r) => r.unitNo), `${sort} ${dir}`).toEqual(expected(base, key, dir).map((r) => r.unitNo));
        }
      }
    });

    it("stays stable across pages, keeps filters and search, and ignores invalid values", async () => {
      await db.insert(units).values(Array.from({ length: 55 }, (_, i) => ({ projectId: f.projectId, unitNo: `P${String(i).padStart(3, "0")}`, areaSqft: 100, basePrice: 1, nature: "Same", status: i % 5 ? ("available" as const) : ("sold" as const) })));
      const first = await list({ sort: "area", dir: "asc" });
      expect(first).toMatchObject({ total: 55, pageCount: 2 });
      expect(first.rows).toHaveLength(50);
      const all = await walk(list, { sort: "area", dir: "asc" });
      expect(all.map((r) => r.unitNo)).toEqual(Array.from({ length: 55 }, (_, i) => `P${String(i).padStart(3, "0")}`));

      const filtered = await list({ status: "sold", q: "P00", sort: "unit", dir: "desc" });
      expect(filtered.rows.map((r) => r.unitNo)).toEqual(["P005", "P000"]);
      expect(filtered.total).toBe(2);

      const plain = (await list({})).rows.map((r) => r.id);
      for (const bad of [{ sort: "base_price; drop table units" }, { sort: "id" }, { sort: "comment" }]) expect((await list(bad)).rows.map((r) => r.id)).toEqual(plain);
      expect((await list({ sort: "unit", dir: "sideways" })).query).toMatchObject({ sort: "unit", dir: "desc" });
    });

    it("permissions are unchanged", async () => {
      await seedUnits();
      expect(await errorCode(listUnits(db, f.actors.hr, { sort: "price" }, null))).toBe("FORBIDDEN");
      for (const who of [f.actors.agent1, accountant, f.actors.manager]) expect((await listUnits(db, who, { project: "all", sort: "price" }, null)).total).toBe(4);
    });
  });

  describe("Payments", () => {
    const list = (q: Record<string, string>) => listPayments(db, accountant, q);
    type Row = Awaited<ReturnType<typeof listPayments>>["rows"][number];
    const KEYS: Record<string, (r: Row) => Key> = {
      ref: (r) => [r.kind === "payment" ? 0 : 1, Number(r.kind === "payment" ? r.receiptNo : r.reversalRef)],
      receivedOn: (r) => r.receivedOn,
      lead: (r) => r.leadName,
      unit: (r) => r.unitNo,
      project: (r) => r.projectName,
      type: (r) => r.type,
      method: (r) => r.methodName,
      amount: (r) => (r.kind === "payment" ? Number(r.amount) : -Number(r.amount)),
      status: (r) => (r.kind !== "payment" ? 2 : r.reversed ? 1 : 0),
      recorded: (r) => new Date(r.recordedAt).getTime(),
    };
    const seedPayments = async () => {
      const a = await bookingFor(f.actors.agent1, ["token_pending"], "500", "Zed Buyer");
      const b = await bookingFor(f.actors.agent2, ["token_pending"], "500", "Amy Buyer");
      const first = await pay(a, "5000");
      await pay(a, "1000", { type: "installment", methodId: bankId, receivedOn: "2026-10-01" });
      await pay(b, "9000", { type: "down_payment", receivedOn: "2026-09-15" });
      await pay(b, "9000", { methodId: bankId });
      await reverse(first.paymentId);
      return { a, b };
    };

    it("sorts every column both ways; a reversal sorts as the negative it shows", async () => {
      await seedPayments();
      const base = await walk(list);
      expect(base).toHaveLength(5);
      for (const [sort, key] of Object.entries(KEYS)) {
        for (const dir of ["asc", "desc"] as const) {
          expect((await walk(list, { sort, dir })).map((r) => r.id), `${sort} ${dir}`).toEqual(expected(base, key, dir).map((r) => r.id));
        }
      }
      expect((await list({ sort: "amount", dir: "asc" })).rows[0]).toMatchObject({ kind: "reversal" });
    });

    it("keeps reversal state, filters and totals whatever the order", async () => {
      const { a } = await seedPayments();
      const before = await netPaid(db, a);
      const sorted = await list({ sort: "status", dir: "desc" });
      expect(sorted.rows.map((r) => (r.kind === "reversal" ? "reversal" : r.reversed ? "reversed" : "posted"))).toEqual(["reversal", "reversed", "posted", "posted", "posted"]);
      expect((await list({ kind: "reversal", sort: "amount" })).rows.map((r) => r.kind)).toEqual(["reversal"]);
      expect((await list({ method: bankId, sort: "amount", dir: "desc" })).rows.map((r) => Number(r.amount))).toEqual([9000, 1000]);
      expect(await netPaid(db, a)).toBe(before);
      expect((await collectionsByProject(db, accountant, { from: "2026-09-01", to: TODAY })).totals).toMatchObject({ received: 24_000, reversed: 5_000, net: 19_000 });
    });

    it("stays stable across pages, ignores invalid values, and keeps its permissions", async () => {
      const bookingId = await bookingFor();
      for (let i = 0; i < 55; i += 1) await pay(bookingId, "10");
      const all = await walk(list, { sort: "amount", dir: "desc" });
      expect(all).toHaveLength(55);
      expect(new Set(all.map((r) => r.id)).size).toBe(55);
      expect((await list({ sort: "amount", dir: "desc" })).rows).toHaveLength(50);
      const plain = (await list({})).rows.map((r) => r.id);
      expect((await list({ sort: "receipt_no; drop table bookings" })).rows.map((r) => r.id)).toEqual(plain);
      for (const who of [f.actors.manager, f.actors.agent1, f.actors.hr]) expect(await errorCode(listPayments(db, who, { sort: "amount" }))).toBe("FORBIDDEN");
      expect((await listPayments(db, admin, { sort: "amount" })).total).toBe(55);
    });
  });

  describe("Finance entries", () => {
    const list = (q: Record<string, string>) => listEntries(db, admin, q);
    type Row = Awaited<ReturnType<typeof listEntries>>["rows"][number];
    const KEYS: Record<string, (r: Row) => Key> = {
      date: (r) => r.entryDate,
      kind: (r) => r.kind,
      category: (r) => r.categoryName,
      payee: (r) => blank(r.payee) ?? blank(r.reference),
      amount: (r) => Number(r.amount),
    };
    const seedEntries = async () => {
      const rent = (await addCategory(db, f.actors.superAdmin, { kind: "expense", name: "Office rent" })).categoryId;
      const fees = (await addCategory(db, f.actors.superAdmin, { kind: "income", name: "Commission" })).categoryId;
      const add = (v: Record<string, unknown>) => createEntry(db, accountant, v);
      await add({ kind: "expense", categoryId: rent, amount: "150000", entryDate: "2026-11-01", payee: "Zed Landlord" });
      await add({ kind: "expense", categoryId: rent, amount: "20000", entryDate: "2026-10-01", payee: "amy cleaner", reference: "INV-9" });
      await add({ kind: "income", categoryId: fees, amount: "400000", entryDate: "2026-11-02", reference: "Bank ref" });
      await add({ kind: "income", categoryId: fees, amount: "20000", entryDate: "2026-09-01" });
      return { rent, fees };
    };

    it("sorts every column both ways; a blank payee falls back to the reference; totals don't move", async () => {
      await seedEntries();
      const base = await walk(list);
      const totals = (await list({})).totals;
      for (const [sort, key] of Object.entries(KEYS)) {
        for (const dir of ["asc", "desc"] as const) {
          expect((await walk(list, { sort, dir })).map((r) => r.id), `${sort} ${dir}`).toEqual(expected(base, key, dir).map((r) => r.id));
          expect((await list({ sort, dir })).totals).toEqual(totals);
        }
      }
      expect(totals).toEqual({ income: 420_000, expense: 170_000, net: 250_000 });
    });

    it("keeps filters, voided handling, pages, invalid values and permissions", async () => {
      const { rent } = await seedEntries();
      expect((await list({ kind: "income", sort: "amount", dir: "asc" })).rows.map((r) => Number(r.amount))).toEqual([20_000, 400_000]);
      expect((await list({ q: "landlord", sort: "date" })).total).toBe(1);
      const first = (await list({ sort: "amount", dir: "desc" })).rows[0];
      await voidEntry(db, accountant, first.id, { reason: "Entered twice by mistake" });
      expect((await list({ sort: "amount", dir: "desc" })).rows.map((r) => r.id)).not.toContain(first.id);
      expect((await list({ voided: "include", sort: "amount", dir: "desc" })).rows[0].id).toBe(first.id);

      for (let i = 0; i < 55; i += 1) await createEntry(db, accountant, { kind: "expense", categoryId: rent, amount: "10", entryDate: "2026-08-01" });
      const all = await walk(list, { sort: "date", dir: "asc" });
      expect(all).toHaveLength(58);
      expect(new Set(all.map((r) => r.id)).size).toBe(58);
      expect((await list({ sort: "date", dir: "asc" })).rows).toHaveLength(50);
      const plain = (await list({})).rows.map((r) => r.id);
      expect((await list({ sort: "amount; drop table files" })).rows.map((r) => r.id)).toEqual(plain);
      for (const who of [f.actors.manager, f.actors.agent1, f.actors.hr]) expect(await errorCode(listEntries(db, who, { sort: "amount" }))).toBe("FORBIDDEN");
    });
  });

  describe("Outstanding", () => {
    const list = (q: Record<string, string>) => listOutstanding(db, accountant, q, TODAY);
    type Row = Awaited<ReturnType<typeof listOutstanding>>["rows"][number];
    const STAGE_ORDER = ["negotiation", "token_pending", "token_received", "provisional_receipt", "sales_order", "booking_form", "down_payment", "agreement_pending", "confirmed"];
    const KEYS: Record<string, (r: Row) => Key> = {
      lead: (r) => r.leadName,
      unit: (r) => r.unitNo,
      project: (r) => r.projectName,
      agent: (r) => r.agentName,
      stage: (r) => STAGE_ORDER.indexOf(r.stage),
      total: (r) => r.totalSale,
      paid: (r) => r.paid,
      outstanding: (r) => r.outstanding,
      due: (r) => r.dueToDate,
      overdue: (r) => r.overdue,
      milestone: (r) => (r.milestoneMet ? 1 : 0),
    };
    const plan = async (bookingId: string, rows: { amount: number; dueOn: string | null }[]) => {
      const [t] = await db.insert(tasks).values({ title: "Plan", type: "payment_plan", assigneeId: f.actors.agent1.id, bookingId, proposal: {} as never }).returning({ id: tasks.id });
      await db.insert(taskInstallmentRows).values(rows.map((r, i) => ({ taskId: t.id, seq: i + 1, label: `Row ${i + 1}`, amount: r.amount, dueOn: r.dueOn })));
    };
    /** Totals 500,000 / 800,000 / 300,000 / 500,000; mixed paid, plans, reversal, a booking with no agent, one cancelled. */
    const seedOutstanding = async () => {
      const a = await bookingFor(f.actors.agent1, ["token_pending"], "500", "Zed Buyer");
      const b = await bookingFor(f.actors.agent2, ["token_pending", "token_received"], "800", "Amy Buyer");
      const c = await bookingFor(f.actors.agent1, ["token_pending"], "300", "Mia Buyer");
      const d = await bookingFor(f.actors.outsideAgent, ["token_pending"], "500", "Bob Buyer");
      const gone = await bookingFor(f.actors.agent1, [], "900", "Gone Buyer");
      await cancelBooking(db, f.actors.superAdmin, gone, { reason: "Buyer withdrew" });
      await pay(a, "150000");
      const wrong = await pay(a, "50000");
      await reverse(wrong.paymentId);
      await pay(b, "100000");
      await pay(c, "300000");
      await plan(a, [{ amount: 100_000, dueOn: "2026-01-10" }, { amount: 100_000, dueOn: "2026-02-10" }, { amount: 100_000, dueOn: "2099-01-10" }]);
      await plan(b, [{ amount: 300_000, dueOn: null }, { amount: 50_000, dueOn: "2026-03-10" }]);
      await db.update(bookings).set({ agentId: null }).where(eq(bookings.id, d));
      return { a, b, c, d };
    };

    it("sorts every column both ways, across computed figures, with no-plan and no-agent rows last", async () => {
      await seedOutstanding();
      const base = await walk(list);
      expect(base).toHaveLength(4);
      for (const [sort, key] of Object.entries(KEYS)) {
        for (const dir of ["asc", "desc"] as const) {
          expect((await walk(list, { sort, dir })).map((r) => r.bookingId), `${sort} ${dir}`).toEqual(expected(base, key, dir).map((r) => r.bookingId));
        }
      }
    });

    it("the screen's rows and totals equal the report calculation, under every filter", async () => {
      await seedOutstanding();
      const byId = <T extends { bookingId: string }>(rows: T[]) => [...rows].sort((x, y) => x.bookingId.localeCompare(y.bookingId));
      for (const q of [{}, { milestone: "met" }, { milestone: "not_met" }, { overdue: "yes" }, { agent: f.actors.agent1.id }, { project: f.projectId }, { q: "amy" }, { milestone: "not_met", overdue: "yes" }] as Record<string, string>[]) {
        const screen = await list({ ...q, sort: "paid" });
        const report = await outstandingBookings(db, accountant, q, TODAY);
        expect(byId(screen.rows), JSON.stringify(q)).toEqual(byId(report.rows));
        expect(screen.totals, JSON.stringify(q)).toEqual(report.totals);
        expect(screen.total).toBe(report.rows.length);
        expect(screen.agents).toEqual(report.agents);
      }
    });

    it("a reversal moves the figures the same in both, and leaves the report unchanged in shape", async () => {
      const { c } = await seedOutstanding();
      const before = (await list({ sort: "paid", dir: "desc" })).rows.map((r) => r.bookingId);
      expect(before[0]).toBe(c);
      const [row] = (await listPayments(db, accountant, { bookingId: c })).rows;
      await reverse(row.id);
      const after = await list({ sort: "paid", dir: "desc" });
      expect(after.rows.find((r) => r.bookingId === c)).toMatchObject({ paid: 0, outstanding: 300_000, milestoneMet: false });
      expect(after.rows[0].bookingId).not.toBe(c);
      expect(after.totals).toEqual((await outstandingBookings(db, accountant, {}, TODAY)).totals);
      const grouped = await outstandingBy(db, accountant, "project");
      expect(grouped.totals.outstanding).toBe(after.totals.outstanding);
    });

    it("pages 50 at a time in the database, stable for equal values, and keeps its permissions", async () => {
      for (let i = 0; i < 53; i += 1) await bookingFor(f.actors.agent1, ["token_pending"], "100");
      const first = await list({ sort: "total" });
      expect(first).toMatchObject({ total: 53, page: 1, pageCount: 2 });
      expect(first.rows).toHaveLength(50);
      expect(first.totals.total).toBe(53 * 100_000);
      const last = await list({ sort: "total", page: "2" });
      expect(last.rows).toHaveLength(3);
      expect(new Set([...first.rows, ...last.rows].map((r) => r.bookingId)).size).toBe(53);
      expect(last.totals).toEqual(first.totals);
      expect((await list({ sort: "total", page: "99" })).page).toBe(2);
      const plain = (await list({})).rows.map((r) => r.bookingId);
      expect((await list({ sort: "paid; drop table bookings", dir: "sideways" })).rows.map((r) => r.bookingId)).toEqual(plain);
      for (const who of [f.actors.manager, f.actors.agent1, f.actors.hr]) expect(await errorCode(listOutstanding(db, who, { sort: "paid" }))).toBe("FORBIDDEN");
      expect((await listOutstanding(db, admin, { sort: "paid" })).total).toBe(53);
    });

    it("the default order is unchanged: project, then unit", async () => {
      await seedOutstanding();
      await db.update(projects).set({ name: "Test Project" }).where(eq(projects.id, f.projectId));
      expect((await list({})).rows.map((r) => r.unitNo)).toEqual((await outstandingBookings(db, accountant, {}, TODAY)).rows.map((r) => r.unitNo));
    });
  });
});
