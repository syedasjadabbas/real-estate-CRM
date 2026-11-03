import type { Database } from "@/server/db";
import { auditLogs } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { createUnit } from "./commands";
import { assertCanInventory } from "./policy";

/**
 * FR-075 bulk unit import from CSV ("Validation report produced"). Every row goes through the same
 * rules as creating a unit by hand (`createUnit`: field validation, the project's dimension lists,
 * unique unit numbers). A check never writes anything; an import writes all rows or none, so a file
 * with any error changes nothing. Each created unit is audited, plus one summary row.
 */
export const UNIT_IMPORT_COLUMNS = ["unit_no", "floor", "block", "area_sqft", "base_price", "sale_model", "nature", "category", "type", "bedrooms", "premium", "comment", "listed_on"] as const;
const REQUIRED = ["unit_no", "area_sqft", "base_price"] as const;
const FIELD: Record<(typeof UNIT_IMPORT_COLUMNS)[number], string> = {
  unit_no: "unitNo",
  floor: "floor",
  block: "block",
  area_sqft: "areaSqft",
  base_price: "basePrice",
  sale_model: "saleModel",
  nature: "nature",
  category: "category",
  type: "type",
  bedrooms: "bedrooms",
  premium: "premium",
  comment: "comment",
  listed_on: "listedOn",
};
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** RFC 4180 CSV: commas, double-quoted fields with "" escapes, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export type ImportRowResult = { line: number; unitNo: string; ok: boolean; message?: string };

class Rollback extends Error {}

export async function importUnits(db: Database, actor: Actor, input: { projectId: string; csv: string; apply: boolean }) {
  assertCanInventory(actor, "manage");
  if (input.csv.length > MAX_IMPORT_BYTES) throw new AppError("VALIDATION_FAILED", "The file is too large (at most 2 MB).", { fields: { file: "At most 2 MB" } });
  const rows = parseCsv(input.csv);
  if (rows.length < 2) throw new AppError("VALIDATION_FAILED", "The file has no unit rows.", { fields: { file: "Add a header row and at least one unit" } });
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const unknown = header.filter((h) => h && !(UNIT_IMPORT_COLUMNS as readonly string[]).includes(h));
  const missing = REQUIRED.filter((r) => !header.includes(r));
  if (unknown.length || missing.length) {
    const parts = [missing.length ? `missing ${missing.join(", ")}` : "", unknown.length ? `unknown ${unknown.join(", ")}` : ""].filter(Boolean).join("; ");
    throw new AppError("VALIDATION_FAILED", `Check the header row: ${parts}.`, { fields: { file: `Columns: ${UNIT_IMPORT_COLUMNS.join(", ")}` } });
  }
  const body = rows.slice(1);
  if (body.length > MAX_IMPORT_ROWS) throw new AppError("VALIDATION_FAILED", `At most ${MAX_IMPORT_ROWS} units per file.`, { fields: { file: `At most ${MAX_IMPORT_ROWS} rows` } });

  const results: ImportRowResult[] = [];
  try {
    await db.transaction(async (tx) => {
      for (const [i, cells] of body.entries()) {
        const record: Record<string, unknown> = { projectId: input.projectId };
        header.forEach((h, j) => {
          const v = (cells[j] ?? "").trim();
          if (h && v !== "") record[FIELD[h as (typeof UNIT_IMPORT_COLUMNS)[number]]] = v;
        });
        const unitNo = String(record.unitNo ?? "");
        try {
          // Each row is its own savepoint: a bad row is rolled back and reported, the rest continue.
          await createUnit(tx as unknown as Database, actor, record);
          results.push({ line: i + 2, unitNo, ok: true });
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          const detail = error.fields ? Object.entries(error.fields).map(([k, m]) => `${k}: ${m}`).join("; ") : error.message;
          results.push({ line: i + 2, unitNo, ok: false, message: detail });
        }
      }
      const failed = results.filter((r) => !r.ok).length;
      if (!input.apply || failed > 0) throw new Rollback();
      await tx.insert(auditLogs).values({ actorId: actor.id, action: "unit.import", entity: "project", entityId: input.projectId, before: null, after: { created: results.length } });
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  const failed = results.filter((r) => !r.ok).length;
  return { applied: input.apply && failed === 0, total: results.length, valid: results.length - failed, failed, rows: results };
}
