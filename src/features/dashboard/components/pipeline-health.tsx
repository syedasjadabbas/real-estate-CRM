import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import type { PipelineHealth as PipelineHealthData } from "../types";

const BUCKETS = ["0-1", "2-5", "6-10", "11-20", "20+"] as const;

const tileTones = {
  amber: "border-amber-200 bg-amber-50/70 [&_.label]:text-amber-700 [&_.value]:text-amber-950 [&_.hint]:text-amber-800",
  neutral: "border-zinc-200/80 bg-zinc-50/60 [&_.label]:text-zinc-500 [&_.value]:text-zinc-950 [&_.hint]:text-zinc-600",
  brand: "border-brand/25 bg-brand-50/70 [&_.label]:text-brand [&_.value]:text-brand-700 [&_.hint]:text-brand",
} as const;

function HealthTile({
  tone,
  label,
  value,
  hint,
}: {
  tone: keyof typeof tileTones;
  label: string;
  value: number | null;
  hint: string;
}) {
  return (
    <div className={cn("rounded-2xl border px-4 py-3", tileTones[tone])}>
      <p className="label text-[10px] font-black tracking-[0.05em] uppercase">{label}</p>
      <p className="value text-2xl leading-8 font-black tabular-nums">{formatInt(value)}</p>
      <p className="hint text-[11px] font-medium">{hint}</p>
    </div>
  );
}

/** "Aging vs Meetings" pipeline-health matrix. */
export function PipelineHealth({ data }: { data: PipelineHealthData | null }) {
  const totals = data?.rows.reduce(
    (acc, row) => {
      row.buckets.forEach((n, i) => (acc.buckets[i] += n));
      acc.leads += row.leads;
      acc.meetings += row.meetings;
      return acc;
    },
    { buckets: [0, 0, 0, 0, 0], leads: 0, meetings: 0 },
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Aging vs Meetings"
        badge={<Badge>Pipeline health</Badge>}
        description="Engaged pipeline matrix (excludes unengaged imports). Meetings = calendar completed + pipeline meeting-done. Stale = no update in 14d · window 30d"
      />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <HealthTile tone="amber" label="Stale pipeline" value={data?.stale ?? null} hint="No record update in 14d+" />
          <HealthTile tone="neutral" label="No meeting (window)" value={data?.noMeeting ?? null} hint="Zero meetings in 30d" />
          <HealthTile tone="brand" label="Meetings done" value={data?.meetingsDone ?? null} hint="Completed in window" />
        </div>

        {data && data.rows.length > 0 && totals ? (
          <div className="overflow-hidden rounded-2xl border border-zinc-200/80">
            <Table>
              <THead>
                <TR>
                  <TH>Lead age</TH>
                  {BUCKETS.map((b) => (
                    <TH key={b}>{b}</TH>
                  ))}
                  <TH align="right" className="bg-zinc-100/60">Leads</TH>
                  <TH align="right">Meetings</TH>
                  <TH align="right">Avg / owner</TH>
                </TR>
              </THead>
              <TBody>
                {data.rows.map((row) => (
                  <TR key={row.age}>
                    <TD className="font-black">{row.age}</TD>
                    {row.buckets.map((n, i) => (
                      <TD key={BUCKETS[i]} className="text-zinc-600 tabular-nums">
                        {formatInt(n)}
                      </TD>
                    ))}
                    <TD align="right" className="bg-zinc-50/80 font-black tabular-nums">{formatInt(row.leads)}</TD>
                    <TD align="right" className="tabular-nums">{formatInt(row.meetings)}</TD>
                    <TD align="right" className="tabular-nums">{formatInt(row.avgPerOwner)}</TD>
                  </TR>
                ))}
                <TR className="bg-zinc-50/80 font-black">
                  <TD>Total</TD>
                  {totals.buckets.map((n, i) => (
                    <TD key={BUCKETS[i]} className="tabular-nums">{formatInt(n)}</TD>
                  ))}
                  <TD align="right" className="tabular-nums">{formatInt(totals.leads)}</TD>
                  <TD align="right" className="tabular-nums">{formatInt(totals.meetings)}</TD>
                  <TD align="right" className="tabular-nums">—</TD>
                </TR>
              </TBody>
            </Table>
          </div>
        ) : (
          <EmptyState>No engaged pipeline to analyse yet.</EmptyState>
        )}
      </div>
    </Card>
  );
}
