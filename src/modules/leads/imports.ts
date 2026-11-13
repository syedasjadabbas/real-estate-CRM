import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { cityNameSchema } from "@/modules/cities/validation";
import { leadsWithAnyNumber, normalizeExtraPhones } from "@/modules/contacts/phones";
import { CsvFormatError, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsvRows } from "@/modules/inventory/import";
import type { Database } from "@/server/db";
import { auditLogs, budgetRanges, cities, leadImportBatches, leadImportRows, leadSources, projects, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { createLead } from "./commands";
import { PRIORITIES } from "./constants";
import { normalizePhone } from "./phone";
import { leadFieldsSchema } from "./validation";

/**
 * Lead import batches. Agents, managers and admins submit a CSV; every row is validated and checked
 * for duplicates (within the file and against existing leads) when it is submitted. Nothing reaches
 * the live leads or the assignment pool until a Super Admin approves the batch. Manual leads never
 * go through batches.
 */
export const LEAD_IMPORT_COLUMNS = ["name", "phone_country_code", "phone", "phone2", "phone3", "phone4", "phone5", "email", "source", "city", "budget", "priority", "size", "gender", "note"] as const;
const REQUIRED = ["name", "phone", "source"] as const;

/**
 * Bulk import is an Admin and Super Admin task (owner's decision, 13 Nov 2026); agents and managers
 * add leads one by one. Every batch, including a Super Admin's own, waits for a Super Admin's approval.
 */
export const canSubmitImport = (actor: Pick<Actor, "role">) => actor.role === "admin" || actor.role === "super_admin";
export const canDecideImport = (actor: Pick<Actor, "role">) => actor.role === "super_admin";

const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const fail = (message: string) => new AppError("VALIDATION_FAILED", message, { fields: { csv: message } });

type RowData = Record<string, unknown>;

/** Validates one CSV row into lead input, or the reasons it can't be one. */
function validateRow(
  cells: Record<string, string>,
  lookup: { sources: Map<string, string>; cities: Map<string, string>; budgets: Map<string, string> },
): { data: RowData; numbers: string[]; errors: string[] } {
  const errors: string[] = [];
  const get = (k: string) => (cells[k] ?? "").trim();
  const countryCode = get("phone_country_code") || "+92";
  const primary = normalizePhone(countryCode, get("phone"));
  if (!primary) errors.push("Phone: enter a valid number");
  let extras: { countryCode: string; number: string }[] = ["phone2", "phone3", "phone4", "phone5"].map((k) => ({ countryCode, number: get(k) }));
  let numbers: string[] = primary ? [primary.e164] : [];
  if (primary) {
    try {
      const normalized = normalizeExtraPhones(primary.e164, extras);
      numbers = [primary.e164, ...normalized.map((p) => p.e164)];
    } catch (e) {
      if (e instanceof AppError) errors.push(...Object.entries(e.fields ?? {}).map(([k, v]) => `Phone ${Number(k.split(".")[1]) + 2}: ${v.toLowerCase()}`));
      extras = [];
    }
  }
  const sourceId = lookup.sources.get(get("source").toLowerCase());
  if (get("source") && !sourceId) errors.push(`Source: "${get("source")}" isn't on the list`);
  const budgetId = get("budget") ? lookup.budgets.get(get("budget").toLowerCase()) : undefined;
  if (get("budget") && !budgetId) errors.push(`Budget: "${get("budget")}" isn't on the list`);
  let city: { cityId?: string; cityOther?: string } = {};
  if (get("city")) {
    const listed = lookup.cities.get(get("city").toLowerCase());
    if (listed) city = { cityId: listed };
    else {
      const typed = cityNameSchema.safeParse(get("city"));
      if (typed.success) city = { cityId: "other", cityOther: typed.data };
      else errors.push(`City: ${typed.error.issues[0].message.toLowerCase()}`);
    }
  }
  const priority = get("priority").toLowerCase() || "none";
  if (!(PRIORITIES as readonly string[]).includes(priority)) errors.push(`Priority: use ${PRIORITIES.join(", ")}`);
  const data: RowData = {
    name: get("name"),
    phoneCountryCode: countryCode,
    phoneNumber: get("phone"),
    phones: extras,
    email: get("email"),
    sourceId: sourceId ?? "",
    budgetRangeId: budgetId ?? "",
    priority,
    desiredSize: get("size"),
    gender: get("gender"),
    note: get("note"),
    ...city,
  };
  const parsed = leadFieldsSchema.safeParse(data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "");
      if (field === "sourceId" && !get("source")) continue; // reported as a missing column value below
      if (["phoneNumber", "phones", "cityId", "cityOther", "budgetRangeId", "priority"].includes(field)) continue; // checked above
      errors.push(`${field}: ${issue.message}`);
    }
  }
  for (const k of REQUIRED) if (!get(k)) errors.push(`${k === "phone" ? "Phone" : k[0].toUpperCase() + k.slice(1)} is required`);
  return { data, numbers, errors: [...new Set(errors)] };
}

/** Validates a file and stores it as a pending batch. Nothing is created yet. */
export async function submitImport(db: Database, actor: Actor, input: { projectId?: unknown; fileName?: unknown; csv?: unknown }) {
  if (!canSubmitImport(actor)) throw forbidden();
  const projectId = typeof input.projectId === "string" && isId(input.projectId) ? input.projectId : null;
  if (!projectId) throw new AppError("VALIDATION_FAILED", "Choose a project.", { fields: { projectId: "Choose a project" } });
  const csv = typeof input.csv === "string" ? input.csv : "";
  if (!csv.trim()) throw fail("Choose a CSV file");
  if (Buffer.byteLength(csv) > MAX_IMPORT_BYTES) throw fail("The file is larger than 2 MB");
  let parsed: { line: number; cells: string[] }[];
  try {
    parsed = parseCsvRows(csv);
  } catch (e) {
    if (e instanceof CsvFormatError) throw fail(e.message);
    throw e;
  }
  const [header, ...body] = parsed;
  if (!header) throw fail("The file is empty");
  const columns = header.cells.map((c) => c.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !columns.includes(c));
  if (missing.length) throw fail(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected: ${LEAD_IMPORT_COLUMNS.join(", ")}`);
  if (body.length === 0) throw fail("The file has no rows");
  if (body.length > MAX_IMPORT_ROWS) throw fail(`Use at most ${MAX_IMPORT_ROWS} rows per file`);

  return db.transaction(async (tx) => {
    const [project] = await tx.select({ id: projects.id, status: projects.status }).from(projects).where(eq(projects.id, projectId));
    if (!project || project.status !== "active") throw new AppError("VALIDATION_FAILED", "Choose an active project.", { fields: { projectId: "Choose an active project" } });
    const [sourceRows, cityRows, budgetRows] = [
      await tx.select({ id: leadSources.id, name: leadSources.name }).from(leadSources).where(eq(leadSources.isActive, true)),
      await tx.select({ id: cities.id, name: cities.name }).from(cities).where(eq(cities.isActive, true)),
      await tx.select({ id: budgetRanges.id, name: budgetRanges.name }).from(budgetRanges).where(eq(budgetRanges.isActive, true)),
    ];
    const byName = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));
    const lookup = { sources: byName(sourceRows), cities: byName(cityRows), budgets: byName(budgetRows) };

    const seen = new Map<string, number>();
    const rows: Omit<typeof leadImportRows.$inferInsert, "batchId">[] = [];
    const counts = { valid: 0, duplicate: 0, invalid: 0 };
    for (const [i, r] of body.entries()) {
      const cells = Object.fromEntries(columns.map((c, j) => [c, r.cells[j] ?? ""]));
      const { data, numbers, errors } = validateRow(cells, lookup);
      let status: "valid" | "duplicate" | "invalid" = errors.length ? "invalid" : "valid";
      let matchLeadId: string | null = null;
      const duplicateReasons: string[] = [];
      if (status === "valid") {
        const earlier = numbers.map((n) => seen.get(n)).find((n) => n !== undefined);
        if (earlier !== undefined) duplicateReasons.push(`Same number as row ${earlier} of this file`);
        else {
          const [existing] = await leadsWithAnyNumber(tx, numbers, { projectId, originalsOnly: true });
          if (existing) {
            matchLeadId = existing.id;
            duplicateReasons.push(`Already a lead in this project (${existing.code})`);
          }
        }
        if (duplicateReasons.length) status = "duplicate";
      }
      for (const n of numbers) if (!seen.has(n)) seen.set(n, i + 1);
      counts[status] += 1;
      rows.push({ rowNo: i + 1, data, phoneE164: numbers[0] ?? null, status, errors: errors.length ? errors : duplicateReasons.length ? duplicateReasons : null, matchLeadId });
    }
    const fileName = typeof input.fileName === "string" ? input.fileName.slice(0, 200) : null;
    const [batch] = await tx
      .insert(leadImportBatches)
      .values({ projectId, fileName, uploadedById: actor.id, totalRows: body.length, validRows: counts.valid, duplicateRows: counts.duplicate, invalidRows: counts.invalid })
      .returning({ id: leadImportBatches.id });
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(leadImportRows).values(rows.slice(i, i + 500).map((r) => ({ ...r, batchId: batch.id })));
    }
    await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "lead_import.submit", entity: "lead_import_batch", entityId: batch.id, after: { projectId, fileName, totalRows: body.length, ...counts } });
    return { batchId: batch.id, totalRows: body.length, ...counts };
  });
}

/** Batches: a Super Admin sees all of them; everyone else sees their own. */
export async function listImportBatches(db: Database, actor: Actor) {
  if (!canSubmitImport(actor)) throw forbidden();
  return db
    .select({
      id: leadImportBatches.id,
      fileName: leadImportBatches.fileName,
      status: leadImportBatches.status,
      totalRows: leadImportBatches.totalRows,
      validRows: leadImportBatches.validRows,
      duplicateRows: leadImportBatches.duplicateRows,
      invalidRows: leadImportBatches.invalidRows,
      createdLeads: leadImportBatches.createdLeads,
      createdAt: leadImportBatches.createdAt,
      decidedAt: leadImportBatches.decidedAt,
      projectName: projects.name,
      uploaderName: users.name,
    })
    .from(leadImportBatches)
    .innerJoin(projects, eq(projects.id, leadImportBatches.projectId))
    .innerJoin(users, eq(users.id, leadImportBatches.uploadedById))
    .where(canDecideImport(actor) ? undefined : eq(leadImportBatches.uploadedById, actor.id))
    .orderBy(sql`${leadImportBatches.status} = 'pending' desc`, desc(leadImportBatches.createdAt))
    .limit(200);
}

export async function getImportBatch(db: Database, actor: Actor, batchId: string) {
  if (!canSubmitImport(actor) || !isId(batchId)) throw notFound("Import batch");
  const decider = users;
  const [batch] = await db
    .select({ batch: leadImportBatches, projectName: projects.name, uploaderName: users.name })
    .from(leadImportBatches)
    .innerJoin(projects, eq(projects.id, leadImportBatches.projectId))
    .innerJoin(users, eq(users.id, leadImportBatches.uploadedById))
    .where(eq(leadImportBatches.id, batchId));
  if (!batch || (!canDecideImport(actor) && batch.batch.uploadedById !== actor.id)) throw notFound("Import batch");
  const [deciderRow] = batch.batch.decidedById ? await db.select({ name: decider.name }).from(decider).where(eq(decider.id, batch.batch.decidedById)) : [];
  const rows = await db.select().from(leadImportRows).where(eq(leadImportRows.batchId, batchId)).orderBy(leadImportRows.rowNo);
  return { ...batch, deciderName: deciderRow?.name ?? null, rows, canDecide: canDecideImport(actor) && batch.batch.status === "pending" };
}

/**
 * Super Admin decision. A single conditional update moves the batch out of Pending, so a batch is
 * decided once even if two people press at the same moment. On approval each valid row becomes a
 * lead through the normal rules (duplicates checked again, returning customers to their original
 * agent, otherwise scored assignment); a row that has become a duplicate since is skipped.
 */
export async function decideImportBatch(db: Database, actor: Actor, batchId: string, input: { approve?: unknown; note?: unknown }) {
  if (!canDecideImport(actor)) throw forbidden("Only a Super Admin can approve or reject an import batch.");
  if (!isId(batchId)) throw notFound("Import batch");
  const approve = input.approve === true;
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) || null : null;
  if (!approve && !note) throw new AppError("VALIDATION_FAILED", "Give a reason for rejecting.", { fields: { note: "Give a reason for rejecting" } });

  const decided = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(leadImportBatches)
      .set({ status: approve ? "approved" : "rejected", decidedById: actor.id, decidedAt: new Date(), decisionNote: note })
      .where(and(eq(leadImportBatches.id, batchId), eq(leadImportBatches.status, "pending")))
      .returning();
    if (!row) {
      const [exists] = await tx.select({ id: leadImportBatches.id }).from(leadImportBatches).where(eq(leadImportBatches.id, batchId));
      if (!exists) throw notFound("Import batch");
      throw new AppError("CONFLICT", "This batch has already been decided.");
    }
    await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: approve ? "lead_import.approve" : "lead_import.reject", entity: "lead_import_batch", entityId: batchId, before: { status: "pending" }, after: { status: row.status, note } });
    return row;
  });
  if (!approve) return { status: "rejected" as const, created: 0, skipped: 0 };

  const valid = await db.select().from(leadImportRows).where(and(eq(leadImportRows.batchId, batchId), eq(leadImportRows.status, "valid"))).orderBy(leadImportRows.rowNo);
  let created = 0;
  let skipped = 0;
  for (const r of valid) {
    try {
      const outcome = await createLead(db, actor, { ...(r.data as RowData), projectId: decided.projectId, onDuplicate: "reject" });
      if (outcome.outcome !== "created") throw new Error("unexpected");
      await db.update(leadImportRows).set({ status: "created", leadId: outcome.leadId }).where(eq(leadImportRows.id, r.id));
      created += 1;
    } catch (e) {
      const reason = e instanceof AppError ? (e.code === "CONFLICT" ? "Became a duplicate before approval" : e.message) : "Could not be created";
      if (!(e instanceof AppError)) console.error(e);
      await db.update(leadImportRows).set({ status: "skipped", errors: [reason] }).where(eq(leadImportRows.id, r.id));
      skipped += 1;
    }
  }
  await db.update(leadImportBatches).set({ createdLeads: created }).where(eq(leadImportBatches.id, batchId));
  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "lead_import.created", entity: "lead_import_batch", entityId: batchId, after: { created, skipped } });
  return { status: "approved" as const, created, skipped };
}

/** Pending batches waiting for a Super Admin, for a badge or queue. */
export async function pendingImportCount(db: Database, actor: Actor) {
  if (!canDecideImport(actor)) return 0;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(leadImportBatches).where(inArray(leadImportBatches.status, ["pending"]));
  return r?.n ?? 0;
}
