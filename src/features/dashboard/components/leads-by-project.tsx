"use client";

import { ArrowRight, ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { Card, Eyebrow } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { formatInt, formatPct } from "@/lib/format";
import type { ProjectLeads } from "../types";

/** Won out of all leads, the same rule as the Conversion box; a project with no leads has no rate. */
const conversion = (won: number, total: number) => (total ? formatPct(Math.round((won / total) * 1000) / 10) : "—");

/** The client's groups, in his order (25 Nov 2026). Together they are the total. */
const GROUPS = [
  { key: "fresh", label: "New", bar: "bg-sky-500", text: "text-sky-700", hint: "Not opened by the agent yet" },
  { key: "open", label: "Open", bar: "bg-indigo-400", text: "text-indigo-700", hint: "Opened, contact attempted or contacted" },
  { key: "inProgress", label: "In progress", bar: "bg-amber-400", text: "text-amber-700", hint: "Qualified up to booking in process" },
  { key: "future", label: "Future", bar: "bg-zinc-400", text: "text-zinc-600", hint: "Future opportunity" },
  { key: "won", label: "Won", bar: "bg-brand", text: "text-brand", hint: "Booked" },
  { key: "lost", label: "Lost", bar: "bg-rose-500", text: "text-rose-600", hint: "Lost" },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];

const STEPS: { key: keyof ProjectLeads["steps"]; label: string; group: string; bar: string }[] = [
  { key: "opened", label: "Opened", group: "Open", bar: "bg-indigo-400" },
  { key: "attempted", label: "Contact attempted", group: "Open", bar: "bg-indigo-400" },
  { key: "contacted", label: "Contacted", group: "Open", bar: "bg-indigo-400" },
  { key: "qualified", label: "Qualified", group: "In progress", bar: "bg-amber-400" },
  { key: "meetingScheduled", label: "Meeting scheduled", group: "In progress", bar: "bg-amber-400" },
  { key: "meetingDone", label: "Meeting done", group: "In progress", bar: "bg-amber-400" },
  { key: "booking", label: "Booking in process", group: "In progress", bar: "bg-amber-400" },
];

const num = "px-2 py-2 text-right font-bold tabular-nums";

/** One bar split into the groups; each part says its name and number. */
function GroupBar({ counts, total, className }: { counts: Record<GroupKey, number>; total: number; className?: string }) {
  return (
    <div className={cn("flex h-3 overflow-hidden rounded-full bg-zinc-100", className)} role="img" aria-label={GROUPS.map((g) => `${g.label} ${counts[g.key]}`).join(", ")}>
      {total
        ? GROUPS.map((g) => (counts[g.key] ? <span key={g.key} title={`${g.label}: ${formatInt(counts[g.key])}`} style={{ width: `${(counts[g.key] / total) * 100}%` }} className={cn("h-full", g.bar)} /> : null))
        : null}
    </div>
  );
}

/** Every active project with its leads: the groups as a graph and a table, and each stage behind a click (client, 25 Nov 2026). */
export function LeadsByProject({ rows, own }: { rows: ProjectLeads[]; own: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.label.toLowerCase().includes(needle)) : rows;
  const all = Object.fromEntries(GROUPS.map((g) => [g.key, rows.reduce((n, r) => n + r[g.key], 0)])) as Record<GroupKey, number>;
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
        {GROUPS.map((g) => (
          <div key={g.key} title={g.hint} className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.06em] text-zinc-500 uppercase">
              <span aria-hidden="true" className={cn("size-2 rounded-full", g.bar)} />
              {g.label}
            </p>
            <p className={cn("mt-0.5 text-xl leading-7 font-black tabular-nums", g.text)}>{formatInt(all[g.key])}</p>
            <p className="text-[10px] text-zinc-500">{conversion(all[g.key], total)} of all</p>
          </div>
        ))}
      </div>
      <GroupBar counts={all} total={total} className="mt-3 h-4" />

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
          <table className="w-full min-w-[680px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">
                <th scope="col" className="py-2 pr-2">Project</th>
                {[...GROUPS.map((g) => g.label), "Total", "Conversion"].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 text-right whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <Fragment key={p.id}>
                  <tr className="border-b border-zinc-100">
                    <th scope="row" className="py-2 pr-2 font-bold">
                      <button type="button" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)} className="flex w-full items-center gap-1.5 text-left hover:text-brand">
                        <ChevronDown aria-hidden="true" className={cn("size-3.5 shrink-0 text-zinc-400 transition-transform", open === p.id && "rotate-180")} />
                        {p.label}
                      </button>
                      <GroupBar counts={p} total={p.total} className="mt-1.5 h-2" />
                    </th>
                    {GROUPS.map((g) => (
                      <td key={g.key} className={cn(num, g.text)}>
                        {formatInt(p[g.key])}
                      </td>
                    ))}
                    <td className={`${num} font-black`}>{formatInt(p.total)}</td>
                    <td className={`${num} font-black text-brand`}>{conversion(p.won, p.total)}</td>
                  </tr>
                  {open === p.id ? (
                    <tr className="border-b border-zinc-100 bg-zinc-50/60">
                      <td colSpan={GROUPS.length + 3} className="px-3 py-3">
                        <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2" aria-label={`Stages in ${p.label}`}>
                          {STEPS.map((s) => (
                            <li key={s.key} className="grid grid-cols-[130px_minmax(0,1fr)_32px] items-center gap-2 text-[11px]">
                              <span className="font-semibold text-zinc-700">
                                {s.label}
                                <span className="block text-[9px] font-bold tracking-[0.05em] text-zinc-400 uppercase">{s.group}</span>
                              </span>
                              <span className="h-2 overflow-hidden rounded-full bg-zinc-200/70">
                                <span className={cn("block h-full rounded-full", s.bar)} style={{ width: `${p.total ? (p.steps[s.key] / p.total) * 100 : 0}%` }} />
                              </span>
                              <span className="text-right font-black tabular-nums">{formatInt(p.steps[s.key])}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
            {needle ? null : (
              <tfoot>
                <tr className="border-t border-zinc-200 font-black">
                  <th scope="row" className="py-2 pr-2">All projects</th>
                  {GROUPS.map((g) => (
                    <td key={g.key} className={num}>
                      {formatInt(all[g.key])}
                    </td>
                  ))}
                  <td className={num}>{formatInt(total)}</td>
                  <td className={num}>{conversion(all.won, total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-zinc-600">All time. New: not opened yet. Open: opened, contact attempted or contacted. In progress: qualified up to booking in process. Click a project for each stage.</p>
    </Card>
  );
}
