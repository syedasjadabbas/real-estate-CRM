"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { selectClass } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import { importUnitsAction } from "../actions";

type Report = { applied: boolean; total: number; valid: number; failed: number; rows: { line: number; unitNo: string; ok: boolean; message?: string }[] };

const COLUMNS = "unit_no,floor,block,area_sqft,base_price,sale_model,nature,category,type,bedrooms,premium,comment,listed_on";
const MAX_BYTES = 2 * 1024 * 1024;

/** FR-075: check a CSV of units, read the validation report, then import (all rows or none). */
export function UnitImport({ projects, projectId: initialProject }: { projects: { id: string; label: string }[]; projectId: string }) {
  const [projectId, setProjectId] = useState(initialProject);
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (apply: boolean) =>
    startTransition(async () => {
      if (!csv) return;
      const r = await importUnitsAction({ projectId, csv: csv.text, apply });
      if (!r.ok) {
        setReport(null);
        setMsg({ text: r.fields?.file ? `${r.message} ${r.fields.file}` : r.message, ok: false });
        return;
      }
      setReport(r.data);
      if (r.data.applied) {
        setMsg({ text: `${r.data.valid} unit${r.data.valid === 1 ? "" : "s"} imported.`, ok: true });
        setChecked(null);
      } else if (r.data.failed) {
        setMsg({ text: `${r.data.failed} row${r.data.failed === 1 ? "" : "s"} need fixing. Nothing was imported.`, ok: false });
        setChecked(null);
      } else {
        setMsg({ text: `All ${r.data.total} rows are valid. Nothing is saved until you import.`, ok: true });
        setChecked(`${projectId}:${csv.text.length}:${csv.name}`);
      }
    });
  const ready = csv !== null && checked === `${projectId}:${csv.text.length}:${csv.name}`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Project">
          {(id) => (
            <select id={id} className={selectClass} value={projectId} disabled={pending} onChange={(e) => (setProjectId(e.target.value), setChecked(null))}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="CSV file" hint="At most 2,000 units and 2 MB.">
          {(id, d) => (
            <input
              id={id}
              aria-describedby={d}
              type="file"
              accept=".csv,text/csv"
              disabled={pending}
              className="block w-full text-xs text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-200 file:bg-zinc-50 file:px-3 file:py-1.5 file:text-xs file:font-bold"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setReport(null);
                setChecked(null);
                setMsg(null);
                if (!f) return setCsv(null);
                if (f.size > MAX_BYTES) return (setCsv(null), setMsg({ text: "The file is too large (at most 2 MB).", ok: false }));
                setCsv({ name: f.name, text: await f.text() });
              }}
            />
          )}
        </Field>
      </div>
      <p className="text-[11px] text-zinc-500">
        Header row with these columns (unit_no, area_sqft and base_price are required): <code className="break-all">{COLUMNS}</code>. Each row follows the same rules as adding a unit by hand.{" "}
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(`${COLUMNS}\n`)}`} download="units-template.csv" className="font-bold text-brand hover:underline">
          Download template
        </a>
      </p>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
        <Button variant="secondary" size="lg" disabled={pending || !csv} onClick={() => run(false)}>
          Check file
        </Button>
        <Button variant="primary" size="lg" disabled={pending || !ready} onClick={() => run(true)}>
          Import units
        </Button>
      </div>
      {report ? (
        <div className="max-h-[420px] overflow-auto rounded-xl border border-zinc-200/80">
          <table className="w-full border-collapse text-left text-xs" aria-label="Validation report">
            <thead className="sticky top-0 bg-zinc-100">
              <tr className="text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                <th scope="col" className="px-3 py-2">Line</th>
                <th scope="col" className="px-3 py-2">Unit</th>
                <th scope="col" className="px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.line} className="border-t border-zinc-100">
                  <td className="px-3 py-1.5 tabular-nums">{r.line}</td>
                  <td className="px-3 py-1.5 font-semibold">{r.unitNo || "—"}</td>
                  <td className={cn("px-3 py-1.5", r.ok ? "text-brand" : "text-rose-700")}>{r.ok ? (report.applied ? "Imported" : "Valid") : r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
