import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { cityNameSchema } from "@/modules/cities/validation";
import { leadsWithAnyNumber, normalizeExtraPhones } from "@/modules/contacts/phones";
import { CsvFormatError, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsvRows } from "@/modules/inventory/import";
import type { Database } from "@/server/db";
import { auditLogs, budgetRanges, cities, leadImportBatches, leadImportRows, leadSources, projects, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { notify } from "@/modules/notifications/service";
import { joinName } from "@/lib/person-name";
import { createLead } from "./commands";
import { recordImportedRepeat } from "./enquiries";
import { PRIORITIES } from "./constants";
import { normalizePhone } from "./phone";
import { parsePropertyType, parseSize } from "./size";
import { leadFieldsSchema } from "./validation";

/**
 * Lead import batches. Agents, managers and admins submit a CSV; every row is validated and checked
 * for duplicates (within the file and against existing leads) when it is submitted. Nothing reaches
 * the live leads or the assignment pool until a Super Admin approves the batch. Manual leads never
 * go through batches.
 */
export const LEAD_IMPORT_COLUMNS = ["first_name", "last_name", "phone_country_code", "phone", "phone2", "phone3", "phone4", "phone5", "email", "source", "city", "budget", "priority", "property_type", "size", "campaign", "gender", "note"] as const;
/** Headings Facebook's lead form export uses. */
const ALIASES: Record<string, string> = { full_name: "name", phone_number: "phone", campaign_name: "campaign" };
/** Files made before 23 Nov 2026 have one name column instead; they still import. */
const REQUIRED = ["first_name", "phone", "source"] as const;

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
): { data: RowData; numbers: string[]; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Facebook writes numbers as "p:+92300…".
  const get = (k: string) => (cells[k] ?? "").trim().replace(/^p:(?=\+?\d)/, "");
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
  const type = get("property_type") ? parsePropertyType(get("property_type")) : null;
  if (get("property_type") && !type && !/^(other|not sure|other ?\/ ?not sure)$/i.test(get("property_type"))) warnings.push(`Property type "${get("property_type")}" isn't on the list: left empty`);
  const size = /^(other|not sure|other ?\/ ?not sure)$/i.test(get("size")) ? "" : get("size");
  if (size && !parseSize(size)) warnings.push(`Size "${size}" is unclear: kept for the agent to confirm`);
  const priority = get("priority").toLowerCase() || "none";
  if (!(PRIORITIES as readonly string[]).includes(priority)) errors.push(`Priority: use ${PRIORITIES.join(", ")}`);
  const named = get("first_name") || get("last_name");
  const data: RowData = {
    name: named ? (get("first_name") ? joinName(get("first_name"), get("last_name")) : "") : get("name"),
    ...(get("first_name") ? { firstName: get("first_name"), lastName: get("last_name") } : {}),
    phoneCountryCode: countryCode,
    phoneNumber: get("phone"),
    phones: extras,
    email: get("email"),
    sourceId: sourceId ?? "",
    budgetRangeId: budgetId ?? "",
    priority,
    desiredSize: size,
    propertyType: type ?? "",
    campaign: get("campaign"),
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
  for (const k of REQUIRED) {
    if (k === "first_name") {
      if (!data.name) errors.push("First name is required");
    } else if (!get(k)) errors.push(`${k === "phone" ? "Phone" : "Source"} is required`);
  }
  return { data, numbers, errors: [...new Set(errors)], warnings };
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
  const columns = header.cells.map((c) => c.trim().toLowerCase()).map((c) => ALIASES[c] ?? c);
  const missing = REQUIRED.filter((c) => !columns.includes(c) && !(c === "first_name" && columns.includes("name")));
  if (missing.length) throw fail(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected: ${LEAD_IMPORT_COLUMNS.join(", ")}`);
  if (body.length === 0) throw fail("The file has no rows");
  if (body.length > MAX_IMPORT_ROWS) throw fail(`Use at most ${MAX_IMPORT_ROWS} rows per file`);

  return db.transaction(async (tx) => {
    const [project] = await tx.select({ id: projects.id, status: projects.status, archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, projectId));
    if (!project || project.status !== "active" || project.archivedAt) throw new AppError("VALIDATION_FAILED", "Choose an active project.", { fields: { projectId: "Choose an active project" } });
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
      const { data, numbers, errors, warnings } = validateRow(cells, lookup);
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
      rows.push({ rowNo: i + 1, data, phoneE164: numbers[0] ?? null, status, errors: errors.length ? errors : duplicateReasons.length ? duplicateReasons : warnings.length ? warnings : null, matchLeadId });
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
    // Every active Super Admin is told a batch waits for approval (15 Nov 2026); the submitter isn't.
    const superAdmins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "super_admin"), eq(users.status, "active")));
    await notify(
      tx,
      superAdmins.map((u) => ({
        userId: u.id,
        type: "import_requested" as const,
        title: `Lead import to approve: ${counts.valid} lead${counts.valid === 1 ? "" : "s"}`,
        body: `${actor.name} uploaded ${fileName ?? "a CSV"} (${body.length} rows: ${counts.valid} valid, ${counts.duplicate} duplicate, ${counts.invalid} invalid).`,
        link: `/dashboard/leads/import/${batch.id}`,
        dedupeKey: `import_requested:${batch.id}`,
      })),
      actor.id,
    );
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
 * agent, otherwise scored assignment). A row whose customer already has a lead in the project, or got one
 * while the batch waited, is recorded on that lead as a repeat enquiry.
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
    // The Admin who uploaded it hears the decision.
    if (row.uploadedById) {
      await notify(
        tx,
        [{
          userId: row.uploadedById,
          type: "import_decided" as const,
          title: approve ? `Lead import approved${row.fileName ? `: ${row.fileName}` : ""}` : `Lead import rejected${row.fileName ? `: ${row.fileName}` : ""}`,
          body: approve ? `${actor.name} approved it; the valid rows are being added as leads.` : `${actor.name}: ${note}`,
          link: `/dashboard/leads/import/${batchId}`,
          dedupeKey: `import_decided:${batchId}`,
        }],
        actor.id,
      );
    }
    return row;
  });
  if (!approve) return { status: "rejected" as const, created: 0, skipped: 0, repeats: 0 };

  const valid = await db.select().from(leadImportRows).where(and(eq(leadImportRows.batchId, batchId), eq(leadImportRows.status, "valid"))).orderBy(leadImportRows.rowNo);
  let created = 0;
  let skipped = 0;
  let repeats = 0;
  const repeat = async (r: typeof leadImportRows.$inferSelect, leadId: string) => {
    const data = r.data as { sourceId: string; note?: string; campaign?: string };
    const note = [data.campaign ? `Campaign: ${data.campaign}` : null, data.note?.trim() || null].filter(Boolean).join(". ");
    const recorded = await recordImportedRepeat(db, actor, leadId, data.sourceId, note || null);
    if (recorded) repeats += 1;
    return recorded ? "Recorded as a repeat enquiry on the existing lead" : "Already recorded as an enquiry today";
  };
  const known = await db.select().from(leadImportRows).where(and(eq(leadImportRows.batchId, batchId), eq(leadImportRows.status, "duplicate"), isNotNull(leadImportRows.matchLeadId))).orderBy(leadImportRows.rowNo);
  for (const r of known) {
    const result = await repeat(r, r.matchLeadId!);
    await db.update(leadImportRows).set({ errors: [...((r.errors as string[] | null) ?? []), result] }).where(eq(leadImportRows.id, r.id));
  }
  for (const r of valid) {
    try {
      const outcome = await createLead(db, actor, { ...(r.data as RowData), projectId: decided.projectId, onDuplicate: "reject" }, { channel: "import" });
      if (outcome.outcome !== "created") throw new Error("unexpected");
      await db.update(leadImportRows).set({ status: "created", leadId: outcome.leadId }).where(eq(leadImportRows.id, r.id));
      created += 1;
    } catch (e) {
      let reason = e instanceof AppError ? (e.code === "CONFLICT" ? "Became a duplicate before approval" : e.message) : "Could not be created";
      const existingId = e instanceof AppError && e.code === "CONFLICT" ? (e.details as { existingLeadId?: string } | undefined)?.existingLeadId : undefined;
      if (existingId) reason = `${reason}. ${await repeat(r, existingId)}`;
      if (!(e instanceof AppError)) console.error(e);
      await db.update(leadImportRows).set({ status: "skipped", errors: [reason] }).where(eq(leadImportRows.id, r.id));
      skipped += 1;
    }
  }
  await db.update(leadImportBatches).set({ createdLeads: created }).where(eq(leadImportBatches.id, batchId));
  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "lead_import.created", entity: "lead_import_batch", entityId: batchId, after: { created, skipped, repeats } });
  return { status: "approved" as const, created, skipped, repeats };
}

/** Pending batches waiting for a Super Admin, for a badge or queue. */
export async function pendingImportCount(db: Database, actor: Actor) {
  if (!canDecideImport(actor)) return 0;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(leadImportBatches).where(inArray(leadImportBatches.status, ["pending"]));
  return r?.n ?? 0;
}
