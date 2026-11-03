import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database } from "@/server/db";
import { auditLogs, files, financeCategories, financeEntries, paymentMethods, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { putObject, removeObject } from "@/server/storage/local";
import { businessToday } from "@/modules/bookings/today";
import { parse } from "@/modules/clients/support";
import { DOCUMENT_FORMATS, documentFormatOf, MAX_DOCUMENT_BYTES, sniffDocument } from "@/modules/documents/validation";
import { isUniqueViolation } from "@/modules/leads/support";
import { cleanFileName, extensionOf } from "@/modules/recordings/validation";
import { assertCanFinance, canDoFinance } from "./policy";

/**
 * Income (FR-200) and expense (FR-201) records and the income-vs-expense report (FR-205).
 * Access is the Finance model:
 * - view: super admin, admin, accountant;
 * - record, edit, void and attach: super admin, accountant;
 * - categories: super admin (the client's lists, Q-F4).
 * Entries are never deleted: voiding keeps the figures, records who and why, and leaves the entry
 * out of totals. Every edit is audited with before / after values.
 */
import { ENTRY_KINDS, type EntryKind } from "./entry-constants";
export { ENTRY_KIND_LABELS, ENTRY_KINDS, type EntryKind } from "./entry-constants";

const creator = alias(users, "entry_creator");
const voider = alias(users, "entry_voider");
const fileUploader = alias(users, "entry_file_uploader");
const fieldError = (field: string, message: string) => new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { [field]: message } });
const isId = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

const amount = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(/,/g, ""))) : v),
  z
    .number("Amount is required")
    .refine((n) => Number.isFinite(n) && n > 0, "Amount must be greater than 0")
    .refine((n) => n <= 1e12, "Amount is too large")
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use at most 2 decimals"),
);
const text = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`).optional().nullable().transform((v) => (v ? v : null));
const entryFields = {
  categoryId: z.uuid("Choose a category"),
  amount,
  entryDate: z.iso.date("Use a valid date"),
  methodId: z.uuid("Choose a method").optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)),
  reference: text(120),
  payee: text(120),
  note: text(1000),
};
const createSchema = z.object({ kind: z.enum(ENTRY_KINDS, "Choose income or expense"), ...entryFields }).strict();
const updateSchema = z.object(entryFields).partial().strict();
const voidSchema = z.object({ reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500) }).strict();
const categorySchema = z.object({ kind: z.enum(ENTRY_KINDS), name: z.string().trim().min(1, "Enter a name").max(80, "Use at most 80 characters") }).strict();

async function audit(db: Database | Parameters<Parameters<Database["transaction"]>[0]>[0], actor: Actor, action: string, entityId: string, before: unknown, after: unknown) {
  await db.insert(auditLogs).values({ actorId: actor.id, action, entity: "finance_entry", entityId, before, after });
}

// ─── Categories ──────────────────────────────────────────────────────────────

export async function listCategories(db: Database, { activeOnly = false } = {}) {
  return db
    .select({ id: financeCategories.id, kind: financeCategories.kind, name: financeCategories.name, isActive: financeCategories.isActive })
    .from(financeCategories)
    .where(activeOnly ? eq(financeCategories.isActive, true) : undefined)
    .orderBy(asc(financeCategories.kind), asc(financeCategories.sortOrder), asc(sql`lower(${financeCategories.name})`));
}

export async function addCategory(db: Database, actor: Actor, input: unknown) {
  assertCanFinance(actor, "settings");
  const data = parse(categorySchema, input);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(financeCategories).values({ kind: data.kind, name: data.name }).returning({ id: financeCategories.id });
      await tx.insert(auditLogs).values({ actorId: actor.id, action: "finance.category_add", entity: "finance_category", entityId: row.id, before: null, after: data });
      return { categoryId: row.id };
    });
  } catch (error) {
    if (isUniqueViolation(error, "finance_categories_kind_name_uq")) throw fieldError("name", "This category already exists");
    throw error;
  }
}

export async function setCategoryActive(db: Database, actor: Actor, categoryId: string, active: boolean) {
  assertCanFinance(actor, "settings");
  if (!isId(categoryId)) throw notFound("Category");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(financeCategories).where(eq(financeCategories.id, categoryId)).for("update");
    if (!row) throw notFound("Category");
    if (row.isActive === active) return { changed: false };
    await tx.update(financeCategories).set({ isActive: active }).where(eq(financeCategories.id, categoryId));
    await tx.insert(auditLogs).values({ actorId: actor.id, action: active ? "finance.category_activate" : "finance.category_deactivate", entity: "finance_category", entityId: categoryId, before: { isActive: row.isActive }, after: { isActive: active } });
    return { changed: true };
  });
}

// ─── Entries ─────────────────────────────────────────────────────────────────

async function checkRefs(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], kind: EntryKind, categoryId: string | undefined, methodId: string | null | undefined, keepCategoryId?: string, keepMethodId?: string | null) {
  if (categoryId !== undefined && categoryId !== keepCategoryId) {
    const [c] = await tx.select().from(financeCategories).where(eq(financeCategories.id, categoryId));
    if (!c || c.kind !== kind || !c.isActive) throw fieldError("categoryId", `Choose an active ${kind} category`);
  }
  if (methodId && methodId !== keepMethodId) {
    const [m] = await tx.select().from(paymentMethods).where(eq(paymentMethods.id, methodId));
    if (!m || !m.isActive) throw fieldError("methodId", "Choose an active method");
  }
}

export async function createEntry(db: Database, actor: Actor, input: unknown) {
  assertCanFinance(actor, "record");
  const data = parse(createSchema, input);
  if (data.kind === "income" && data.payee) throw fieldError("payee", "Payee is for expenses only");
  return db.transaction(async (tx) => {
    await checkRefs(tx, data.kind, data.categoryId, data.methodId);
    const [row] = await tx.insert(financeEntries).values({ ...data, createdById: actor.id, updatedById: actor.id }).returning({ id: financeEntries.id });
    await audit(tx, actor, `finance.${data.kind}_create`, row.id, null, data);
    return { entryId: row.id };
  });
}

const FIELDS = ["categoryId", "amount", "entryDate", "methodId", "reference", "payee", "note"] as const;

/** Edits an entry that isn't voided. Only changed fields are written, with before / after in the audit log. */
export async function updateEntry(db: Database, actor: Actor, entryId: string, input: unknown) {
  assertCanFinance(actor, "record");
  const data = parse(updateSchema, input);
  if (!isId(entryId)) throw notFound("Entry");
  return db.transaction(async (tx) => {
    const [entry] = await tx.select().from(financeEntries).where(eq(financeEntries.id, entryId)).for("update");
    if (!entry) throw notFound("Entry");
    if (entry.voidedAt) throw new AppError("BUSINESS_RULE", "A voided entry can't be edited.");
    if (entry.kind === "income" && data.payee) throw fieldError("payee", "Payee is for expenses only");
    await checkRefs(tx, entry.kind, data.categoryId, data.methodId, entry.categoryId, entry.methodId);
    const changed = FIELDS.filter((k) => k in data && String(data[k] ?? "") !== String(entry[k] ?? ""));
    if (!changed.length) return { changed: [] as string[] };
    const next = Object.fromEntries(changed.map((k) => [k, data[k] ?? null]));
    await tx.update(financeEntries).set({ ...next, updatedById: actor.id, updatedAt: new Date() }).where(eq(financeEntries.id, entryId));
    await audit(tx, actor, `finance.${entry.kind}_update`, entryId, Object.fromEntries(changed.map((k) => [k, entry[k]])), next);
    return { changed: changed as string[] };
  });
}

/** Voids an entry with a reason. Nothing is deleted; voided entries are excluded from totals. */
export async function voidEntry(db: Database, actor: Actor, entryId: string, input: unknown) {
  assertCanFinance(actor, "record");
  const { reason } = parse(voidSchema, input);
  if (!isId(entryId)) throw notFound("Entry");
  return db.transaction(async (tx) => {
    const [entry] = await tx.select().from(financeEntries).where(eq(financeEntries.id, entryId)).for("update");
    if (!entry) throw notFound("Entry");
    if (entry.voidedAt) throw new AppError("BUSINESS_RULE", "This entry is already voided.");
    await tx.update(financeEntries).set({ voidedAt: new Date(), voidedById: actor.id, voidReason: reason, updatedAt: new Date() }).where(eq(financeEntries.id, entryId));
    await audit(tx, actor, `finance.${entry.kind}_void`, entryId, { amount: entry.amount }, { reason });
    return { voided: true };
  });
}

const listQuery = z.object({
  kind: z.enum(ENTRY_KINDS).optional().catch(undefined),
  categoryId: z.uuid().optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  voided: z.enum(["include", "only"]).optional().catch(undefined),
});

export async function listEntries(db: Database, actor: Actor, input: unknown = {}) {
  assertCanFinance(actor, "viewAll");
  const q = listQuery.parse(input ?? {});
  const where = and(
    q.kind ? eq(financeEntries.kind, q.kind) : undefined,
    q.categoryId ? eq(financeEntries.categoryId, q.categoryId) : undefined,
    q.from ? gte(financeEntries.entryDate, q.from) : undefined,
    q.to ? lte(financeEntries.entryDate, q.to) : undefined,
    q.voided === "only" ? sql`${financeEntries.voidedAt} is not null` : q.voided === "include" ? undefined : isNull(financeEntries.voidedAt),
  );
  const rows = await db
    .select({
      id: financeEntries.id,
      kind: financeEntries.kind,
      categoryName: financeCategories.name,
      amount: financeEntries.amount,
      entryDate: financeEntries.entryDate,
      methodName: paymentMethods.name,
      reference: financeEntries.reference,
      payee: financeEntries.payee,
      voidedAt: financeEntries.voidedAt,
      createdByName: creator.name,
    })
    .from(financeEntries)
    .innerJoin(financeCategories, eq(financeCategories.id, financeEntries.categoryId))
    .leftJoin(paymentMethods, eq(paymentMethods.id, financeEntries.methodId))
    .leftJoin(creator, eq(creator.id, financeEntries.createdById))
    .where(where)
    .orderBy(desc(financeEntries.entryDate), desc(financeEntries.createdAt))
    .limit(500);
  const live = rows.filter((r) => !r.voidedAt);
  const sum = (k: EntryKind) => Math.round(live.filter((r) => r.kind === k).reduce((n, r) => n + r.amount * 100, 0)) / 100;
  return { query: q, rows, totals: { income: sum("income"), expense: sum("expense"), net: Math.round((sum("income") - sum("expense")) * 100) / 100 } };
}

export async function getEntry(db: Database, actor: Actor, entryId: string) {
  assertCanFinance(actor, "viewAll");
  if (!isId(entryId)) throw notFound("Entry");
  const [row] = await db
    .select({
      id: financeEntries.id,
      kind: financeEntries.kind,
      categoryId: financeEntries.categoryId,
      categoryName: financeCategories.name,
      amount: financeEntries.amount,
      entryDate: financeEntries.entryDate,
      methodId: financeEntries.methodId,
      methodName: paymentMethods.name,
      reference: financeEntries.reference,
      payee: financeEntries.payee,
      note: financeEntries.note,
      createdAt: financeEntries.createdAt,
      createdByName: creator.name,
      voidedAt: financeEntries.voidedAt,
      voidedByName: voider.name,
      voidReason: financeEntries.voidReason,
    })
    .from(financeEntries)
    .innerJoin(financeCategories, eq(financeCategories.id, financeEntries.categoryId))
    .leftJoin(paymentMethods, eq(paymentMethods.id, financeEntries.methodId))
    .leftJoin(creator, eq(creator.id, financeEntries.createdById))
    .leftJoin(voider, eq(voider.id, financeEntries.voidedById))
    .where(eq(financeEntries.id, entryId));
  if (!row) throw notFound("Entry");
  const trail = await db
    .select({ id: auditLogs.id, action: auditLogs.action, before: auditLogs.before, after: auditLogs.after, createdAt: auditLogs.createdAt, actorName: creator.name })
    .from(auditLogs)
    .leftJoin(creator, eq(creator.id, auditLogs.actorId))
    .where(and(eq(auditLogs.entity, "finance_entry"), eq(auditLogs.entityId, entryId)))
    .orderBy(desc(auditLogs.createdAt));
  return { entry: row, trail };
}

// ─── Attachments ─────────────────────────────────────────────────────────────

export async function attachEntryFile(db: Database, actor: Actor, entryId: string, input: { bytes: Uint8Array; name: string }) {
  assertCanFinance(actor, "record");
  if (!isId(entryId)) throw notFound("Entry");
  const [entry] = await db.select({ id: financeEntries.id, voidedAt: financeEntries.voidedAt }).from(financeEntries).where(eq(financeEntries.id, entryId));
  if (!entry) throw notFound("Entry");
  if (entry.voidedAt) throw new AppError("BUSINESS_RULE", "A voided entry can't take new attachments.");
  const name = cleanFileName(input.name);
  const declared = documentFormatOf(extensionOf(name));
  const fail = (m: string) => new AppError("VALIDATION_FAILED", m, { fields: { file: m } });
  if (input.bytes.byteLength === 0) throw fail("The file is empty.");
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw fail("Attachments can be at most 10 MB.");
  if (!declared) throw fail("Upload a PDF, JPG, PNG, DOCX or XLSX file.");
  const format = sniffDocument(input.bytes);
  if (format !== declared) throw fail("The file content does not match its type.");
  const id = randomUUID();
  const now = new Date();
  const storageKey = `finance-entries/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${format}`;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  await putObject(storageKey, input.bytes);
  try {
    return await db.transaction(async (tx) => {
      await tx.insert(files).values({ id, financeEntryId: entryId, kind: "receipt", storageKey, originalName: name, mime: DOCUMENT_FORMATS[format].mime, sizeBytes: input.bytes.byteLength, sha256, uploadedById: actor.id });
      await audit(tx, actor, "finance.entry_attachment", entryId, null, { fileId: id, name, sizeBytes: input.bytes.byteLength, sha256 });
      return { id, name };
    });
  } catch (error) {
    await removeObject(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function listEntryFiles(db: Database, actor: Actor, entryId: string) {
  assertCanFinance(actor, "viewAll");
  if (!isId(entryId)) throw notFound("Entry");
  return db
    .select({ id: files.id, name: files.originalName, mime: files.mime, sizeBytes: files.sizeBytes, createdAt: files.createdAt, uploadedBy: fileUploader.name })
    .from(files)
    .leftJoin(fileUploader, eq(fileUploader.id, files.uploadedById))
    .where(and(eq(files.financeEntryId, entryId), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt));
}

export async function openEntryFile(db: Database, actor: Actor, fileId: string) {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  if (!isId(fileId)) throw notFound("Attachment");
  const [file] = await db.select().from(files).where(and(eq(files.id, fileId), isNull(files.deletedAt), sql`${files.financeEntryId} is not null`));
  if (!file) throw notFound("Attachment");
  return file;
}

// ─── Report (FR-205) ─────────────────────────────────────────────────────────

/** Income, expense and net per month of a calendar year; voided entries excluded. */
export async function incomeExpenseByMonth(db: Database, actor: Actor, input: unknown = {}) {
  assertCanFinance(actor, "viewAll");
  const thisYear = Number(businessToday().slice(0, 4));
  const year = z.coerce.number().int().min(2000).max(2100).catch(thisYear).parse((input as Record<string, unknown>)?.year ?? thisYear);
  const rows = await db
    .select({
      month: sql<number>`extract(month from ${financeEntries.entryDate})::int`,
      income: sql<string>`coalesce(sum(${financeEntries.amount}) filter (where ${financeEntries.kind} = 'income'), 0)`,
      expense: sql<string>`coalesce(sum(${financeEntries.amount}) filter (where ${financeEntries.kind} = 'expense'), 0)`,
    })
    .from(financeEntries)
    .where(and(isNull(financeEntries.voidedAt), sql`extract(year from ${financeEntries.entryDate}) = ${year}`))
    .groupBy(sql`1`);
  const months = Array.from({ length: 12 }, (_, i) => {
    const r = rows.find((x) => x.month === i + 1);
    const income = Number(r?.income ?? 0);
    const expense = Number(r?.expense ?? 0);
    return { month: `${year}-${String(i + 1).padStart(2, "0")}`, income, expense, net: Math.round((income - expense) * 100) / 100 };
  });
  const total = (k: "income" | "expense" | "net") => Math.round(months.reduce((n, m) => n + m[k] * 100, 0)) / 100;
  return { year, months, totals: { income: total("income"), expense: total("expense"), net: total("net") } };
}
