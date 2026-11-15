/**
 * CSV files for downloads (15 Nov 2026). Excel-friendly: a UTF-8 byte-order mark so Urdu names show
 * correctly, CRLF line ends, and quoting where needed. A cell that starts with = + - @ is prefixed with
 * an apostrophe so a spreadsheet never runs it as a formula (CSV injection).
 */
export type CsvValue = string | number | boolean | null | undefined;

function cell(value: CsvValue) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvValue[][]) {
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function csvResponse(filename: string, body: string) {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "-")}"`,
      "cache-control": "no-store",
    },
  });
}
