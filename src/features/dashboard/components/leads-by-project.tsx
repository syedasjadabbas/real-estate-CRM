"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Card, Eyebrow } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { formatInt, formatPct } from "@/lib/format";
import type { ProjectLeads } from "../types";

/** Won out of all leads, the same rule as the Conversion box; a project with no leads has no rate. */
const conversion = (won: number, total: number) => (total ? formatPct(Math.round((won / total) * 1000) / 10) : "—");

/** Every stage on its own (client, 25 Nov 2026), in pipeline order. Together they are the total. */
const STAGES: { label: string; bar: string; text: string; of: (p: ProjectLeads) => number }[] = [
  { label: "New", bar: "bg-sky-400", text: "text-sky-700", of: (p) => p.fresh },
  { label: "Opened", bar: "bg-blue-600", text: "text-blue-700", of: (p) => p.steps.opened },
  { label: "Contact attempted", bar: "bg-indigo-300", text: "text-indigo-700", of: (p) => p.steps.attempted },
  { label: "Contacted", bar: "bg-violet-600", text: "text-violet-700", of: (p) => p.steps.contacted },
  { label: "Qualified", bar: "bg-fuchsia-400", text: "text-fuchsia-700", of: (p) => p.steps.qualified },
  { label: "Meeting scheduled", bar: "bg-amber-300", text: "text-amber-700", of: (p) => p.steps.meetingScheduled },
  { label: "Meeting done", bar: "bg-orange-500", text: "text-orange-700", of: (p) => p.steps.meetingDone },
  { label: "Booking in process", bar: "bg-teal-400", text: "text-teal-700", of: (p) => p.steps.booking },
  { label: "Booked", bar: "bg-emerald-600", text: "text-emerald-700", of: (p) => p.won },
  { label: "Lost", bar: "bg-rose-500", text: "text-rose-600", of: (p) => p.lost },
  { label: "Future opportunity", bar: "bg-zinc-400", text: "text-zinc-600", of: (p) => p.future },
];

const num = "px-1.5 py-2 text-right font-bold tabular-nums";

/** One bar split into the stages; each part says its name and number. */
function StageBar({ counts, total, className }: { counts: number[]; total: number; className?: string }) {
  return (
    <div className={cn("flex gap-px overflow-hidden rounded-full bg-zinc-100", className)} role="img" aria-label={STAGES.map((g, i) => `${g.label} ${counts[i]}`).join(", ")}>
      {total ? STAGES.map((g, i) => (counts[i] ? <span key={g.label} title={`${g.label}: ${formatInt(counts[i])}`} style={{ flexGrow: counts[i], flexBasis: 0 }} className={cn("h-full", g.bar)} /> : null)) : null}
    </div>
  );
}

/** Every active project with its leads: every stage as a graph and as a column (client, 25 Nov 2026). */
export function LeadsByProject({ rows, own }: { rows: ProjectLeads[]; own: boolean }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.label.toLowerCase().includes(needle)) : rows;
  const all = STAGES.map((g) => rows.reduce((n, r) => n + g.of(r), 0));
  const allWon = rows.reduce((n, r) => n + r.won, 0);
  const total = rows.reduce((n, r) => n + r.total, 0);
  return (
    <Card className="min-w-0 p-5">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 pb-3">
        <Eyebrow>{own ? "Your leads by project" : "Leads by project"}</Eyebrow>
        <Link href="/dashboard/leads" className="inline-flex items-center gap-1 text-[10px] font-black tracking-[0.1em] text-zinc-600 uppercase hover:text-brand">
          All leads <ArrowRight aria-hidden="true" className="size-3" />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {STAGES.map((g, i) => (
          <div key={g.label} className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[10px] leading-[13px] font-black tracking-[0.04em] text-zinc-500 uppercase">
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", g.bar)} />
              {g.label}
            </p>
            <p className={cn("mt-0.5 text-xl leading-7 font-black tabular-nums", g.text)}>{formatInt(all[i])}</p>
            <p className="text-[10px] text-zinc-500">{conversion(all[i], total)} of all</p>
          </div>
        ))}
        <div className="rounded-2xl border border-zinc-900 bg-zinc-900 px-3 py-2.5 text-white">
          <p className="text-[10px] leading-[13px] font-black tracking-[0.04em] text-zinc-300 uppercase">Total leads</p>
          <p className="mt-0.5 text-xl leading-7 font-black tabular-nums">{formatInt(total)}</p>
          <p className="text-[10px] text-zinc-300">
            {formatInt(rows.length)} {rows.length === 1 ? "project" : "projects"}
          </p>
        </div>
      </div>
      <StageBar counts={all} total={total} className="mt-3 h-4" />

      {rows.length > 5 ? (
        <div className="relative mt-4">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-zinc-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" className="pl-8" />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState size="sm" className="mt-3">
          {rows.length ? "No project matches." : "No active projects yet."}
        </EmptyState>
      ) : (
        <div className="mt-3 max-h-[28rem] overflow-auto">
          <table className="w-full min-w-[960px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">
                <th scope="col" className="sticky left-0 min-w-[130px] bg-white py-2 pr-2 align-bottom">Project</th>
                {[...STAGES.map((g) => g.label), "Total", "Conversion"].map((h) => (
                  <th key={h} scope="col" className="px-1.5 py-2 text-right align-bottom leading-[13px]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-b border-zinc-100">
                  <th scope="row" className="sticky left-0 bg-white py-2.5 pr-2 font-bold">
                    {p.label}
                    <StageBar counts={STAGES.map((g) => g.of(p))} total={p.total} className="mt-1.5 h-2" />
                  </th>
                  {STAGES.map((g) => {
                    const n = g.of(p);
                    return (
                      <td key={g.label} className={cn(num, n ? g.text : "text-zinc-400")}>
                        {formatInt(n)}
                      </td>
                    );
                  })}
                  <td className={`${num} font-black`}>{formatInt(p.total)}</td>
                  <td className={`${num} font-black text-brand`}>{conversion(p.won, p.total)}</td>
                </tr>
              ))}
            </tbody>
            {needle ? null : (
              <tfoot>
                <tr className="border-t border-zinc-200 font-black">
                  <th scope="row" className="sticky left-0 bg-white py-2 pr-2">All projects</th>
                  {STAGES.map((g, i) => (
                    <td key={g.label} className={num}>
                      {formatInt(all[i])}
                    </td>
                  ))}
                  <td className={num}>{formatInt(total)}</td>
                  <td className={num}>{conversion(allWon, total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-zinc-600">All time. New: not opened by the agent yet. Opened: opened, still a new lead.</p>
    </Card>
  );
}
