import type { ReactNode } from "react";
import { PanelCard } from "@/features/leads/components/detail-panels";

/**
 * A plain details card for people who may view a record but not edit it (15 Nov 2026): labels and
 * values instead of a greyed-out form. Empty values show "—".
 */
export function ReadOnlyDetails({ title, note, rows }: { title: string; note?: ReactNode; rows: { label: string; value: ReactNode; wide?: boolean }[] }) {
  return (
    <PanelCard title={title}>
      {note ? <p className="mb-3 text-[11px] text-zinc-500">{note}</p> : null}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className={r.wide ? "min-w-0 sm:col-span-2" : "min-w-0"}>
            <dt className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{r.label}</dt>
            <dd className="mt-0.5 text-sm font-semibold break-words whitespace-pre-line text-zinc-900">{r.value === null || r.value === undefined || r.value === "" ? "—" : r.value}</dd>
          </div>
        ))}
      </dl>
    </PanelCard>
  );
}
