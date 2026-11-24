"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Card, Eyebrow } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { StackedBar } from "@/components/ui/progress";
import { formatInt, formatPct } from "@/lib/format";
import type { ProjectLeads } from "../types";

/** Won out of all leads, the same rule as the Conversion box; a project with no leads has no rate. */
const conversion = (won: number, total: number) => (total ? formatPct(Math.round((won / total) * 1000) / 10) : "—");

const num = "px-2 py-2 text-right font-bold tabular-nums";

/** Every active project with its leads: total, open, in progress and how the rest ended (client, 23 Nov 2026). */
export function LeadsByProject({ rows, own }: { rows: ProjectLeads[]; own: boolean }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.label.toLowerCase().includes(needle)) : rows;
  const sum = (k: "total" | "open" | "inProgress" | "won" | "lost") => rows.reduce((n, r) => n + r[k], 0);
  return (
    <Card className="min-w-0 p-5">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 pb-3">
        <Eyebrow>{own ? "Your leads by project" : "Leads by project"}</Eyebrow>
        <Link href="/dashboard/leads" className="inline-flex items-center gap-1 text-[10px] font-black tracking-[0.1em] text-zinc-600 uppercase hover:text-brand">
          All leads <ArrowRight aria-hidden="true" className="size-3" />
        </Link>
      </div>
      <p className="mt-2 text-[11px] text-zinc-600">All time. Open: new, contact attempted or future opportunity. In progress: contacted up to booking in process. Conversion: won out of total leads.</p>
      {rows.length > 5 ? (
        <div className="relative mt-3">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-zinc-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" className="pl-8" />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState size="sm" className="mt-3">
          {rows.length ? "No project matches." : "No active projects yet."}
        </EmptyState>
      ) : (
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="w-full min-w-[540px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">
                <th scope="col" className="py-2 pr-2">Project</th>
                {["Total", "Open", "In progress", "Won", "Lost", "Conversion"].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 text-right whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-b border-zinc-100 last:border-b-0">
                  <th scope="row" className="py-2 pr-2 font-bold">
                    {p.label}
                    <StackedBar
                      className="mt-1.5"
                      segments={[
                        { label: "Open", value: p.open, className: "bg-sky-500" },
                        { label: "In progress", value: p.inProgress, className: "bg-amber-400" },
                        { label: "Won", value: p.won, className: "bg-brand" },
                        { label: "Lost", value: p.lost, className: "bg-rose-500" },
                      ]}
                    />
                  </th>
                  <td className={`${num} font-black`}>{formatInt(p.total)}</td>
                  <td className={`${num} text-sky-700`}>{formatInt(p.open)}</td>
                  <td className={`${num} text-amber-700`}>{formatInt(p.inProgress)}</td>
                  <td className={`${num} text-brand`}>{formatInt(p.won)}</td>
                  <td className={`${num} text-rose-600`}>{formatInt(p.lost)}</td>
                  <td className={`${num} font-black text-brand`}>{conversion(p.won, p.total)}</td>
                </tr>
              ))}
            </tbody>
            {needle ? null : (
              <tfoot>
                <tr className="border-t border-zinc-200 font-black">
                  <th scope="row" className="py-2 pr-2">All projects</th>
                  {(["total", "open", "inProgress", "won", "lost"] as const).map((k) => (
                    <td key={k} className={num}>
                      {formatInt(sum(k))}
                    </td>
                  ))}
                  <td className={num}>{conversion(sum("won"), sum("total"))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Card>
  );
}
