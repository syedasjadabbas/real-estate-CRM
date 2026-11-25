import Link from "next/link";
import { Card, Eyebrow } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { wonSummary } from "@/modules/leads/queries";
import { leadsContext } from "../context";
import { flattenParams, withParams, type SearchParams } from "../url";

const PATH = "/dashboard/leads/won";
const isId = (v?: string) => Boolean(v && /^[0-9a-f-]{36}$/i.test(v));

function Bars({ title, rows, active, href }: { title: string; rows: { id: string; label: string; n: number }[]; active?: string; href: (id: string, on: boolean) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{title}</p>
      <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {rows.map((r) => {
          const on = active === r.id;
          return (
            <li key={r.id}>
              <Link href={href(r.id, on)} scroll={false} aria-current={on ? "true" : undefined} title={on ? `Stop filtering by ${r.label}` : `Show ${r.label}'s won leads`} className={cn("block rounded-xl px-2 py-1.5 hover:bg-zinc-100", on && "bg-brand-50 ring-1 ring-brand/40")}>
                <span className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate font-bold">{r.label}</span>
                  <span className="font-black text-brand tabular-nums">{formatInt(r.n)}</span>
                </span>
                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-zinc-100">
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${(r.n / max) * 100}%` }} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Won leads by project, agent and month; each bar filters the table below, and again clears it (client, 25 Nov 2026). */
export async function WonInfographic({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [{ actor, db, projectId, canView }, raw] = await Promise.all([leadsContext(), searchParams]);
  if (!canView || !projectId) return null;
  const params = flattenParams(raw);
  const scope = params.project === "all" ? null : isId(params.project) ? params.project : projectId;
  const data = await wonSummary(db, actor, scope);
  const total = data.byProject.reduce((n, r) => n + r.n, 0);
  if (total === 0) return null;
  const monthLabel = (m: string) => new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
  const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const activeMonth = params.dateField === "decided" && params.from && params.to === lastDay(params.from.slice(0, 7)) && params.from.endsWith("-01") ? params.from.slice(0, 7) : undefined;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 pb-3">
        <Eyebrow>Won at a glance</Eyebrow>
        <Link href={withParams(PATH, params, { project: "all", page: null })} scroll={false} className="text-[11px] font-bold text-zinc-600 hover:text-brand">
          {formatInt(total)} won in all projects
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
        <Bars title="By project" rows={data.byProject} active={scope ?? undefined} href={(id, on) => withParams(PATH, params, { project: on ? "all" : id, page: null })} />
        {data.byAgent.length ? <Bars title="By agent" rows={data.byAgent} active={params.owner} href={(id, on) => withParams(PATH, params, { owner: on ? null : id, page: null })} /> : <EmptyState size="sm">None in this project.</EmptyState>}
        {data.byMonth.length ? (
          <Bars
            title="By month"
            rows={data.byMonth.map((m) => ({ id: m.id, label: monthLabel(m.id), n: m.n }))}
            active={activeMonth}
            href={(id, on) => withParams(PATH, params, on ? { dateField: null, from: null, to: null, period: null, page: null } : { dateField: "decided", period: null, from: `${id}-01`, to: lastDay(id), page: null })}
          />
        ) : null}
      </div>
    </Card>
  );
}
