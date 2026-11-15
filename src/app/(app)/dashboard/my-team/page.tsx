import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { STATUS_TONES } from "@/features/attendance/components/check-in-card";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { flattenParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { ATTENDANCE_STATUS_LABELS } from "@/modules/attendance/rules";
import { STAGE_LABELS } from "@/modules/leads/constants";
import { addDays } from "@/modules/teams/dates";
import { myTeamView } from "@/modules/teams/my-team";
import { ROSTER_STATUS_LABELS } from "@/modules/teams/validation";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "My team" };

const th = "px-3 py-2.5";
const td = "px-3 py-2 whitespace-nowrap";

/** A Team Lead's read-only view of the team they lead (owner, 15 Nov 2026). */
export default async function MyTeamPage({ searchParams }: PageProps<"/dashboard/my-team">) {
  const actor = await requirePageUser();
  if (actor.role !== "agent" || !actor.ledTeamIds?.length) return <RestrictedState />;
  const q = flattenParams(await searchParams);
  const v = await myTeamView(getDb(), actor, q.team, { from: q.from, to: q.to });
  const base = (extra: Record<string, string>) => `/dashboard/my-team?${new URLSearchParams({ ...(v.teams.length > 1 ? { team: v.team.id } : {}), ...extra })}`;
  const presets = [
    { label: "Today", from: v.today },
    { label: "7 days", from: addDays(v.today, -6) },
    { label: "30 days", from: addDays(v.today, -30) },
    { label: "This month", from: `${v.today.slice(0, 7)}-01` },
  ];
  const sum = (f: (m: (typeof v.members)[number]) => number) => v.members.reduce((n, m) => n + f(m), 0);

  return (
    <PageStack>
      <PageHeader title={`My team · ${v.team.name}`} icon={Users} description="You are this team's Team Lead. Everything here is view-only; Admins handle approvals and reassigning." />
      {v.teams.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {v.teams.map((t) => (
            <Link key={t.id} href={`/dashboard/my-team?team=${t.id}`} aria-current={t.id === v.team.id ? "true" : undefined} className={cn("rounded-lg border px-3 py-1.5 text-xs font-bold", t.id === v.team.id ? "border-brand bg-brand text-white" : "border-zinc-200/80 bg-white text-zinc-700")}>
              {t.name}
            </Link>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {presets.map((r) => {
          const on = v.range.from === r.from && v.range.to === v.today;
          return (
            <Link key={r.label} href={base({ from: r.from, to: v.today })} aria-current={on ? "true" : undefined} className={cn("rounded-lg border px-3 py-1.5 text-xs font-bold", on ? "border-brand bg-brand text-white" : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50")}>
              {r.label}
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MiniStat label="Members" value={String(v.members.length)} caption="Active agents" />
        <MiniStat label="Open leads" value={String(sum((m) => m.open))} caption="Right now" />
        <MiniStat label="Overdue follow-ups" value={String(sum((m) => m.overdue))} caption="Right now" />
        <MiniStat label="Calls" value={String(sum((m) => m.metrics.calls))} caption="In range" />
        <MiniStat label="Meetings held" value={String(sum((m) => m.metrics.meetings))} caption="In range" />
        <MiniStat label="Won" value={String(sum((m) => m.metrics.booked))} caption="Leads booked, in range" />
      </div>

      <PanelCard title="Members">
        <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
          <table className="w-full min-w-max border-collapse text-left text-xs">
            <thead className="bg-zinc-100">
              <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                <th scope="col" className={th}>Agent</th>
                <th scope="col" className={th}>Today</th>
                <th scope="col" className={th}>Roster</th>
                <th scope="col" className={th}>Open leads</th>
                <th scope="col" className={th}>Overdue follow-ups</th>
                <th scope="col" className={th}>Calls · min</th>
                <th scope="col" className={th}>Meetings</th>
                <th scope="col" className={th}>Won · lost</th>
              </tr>
            </thead>
            <tbody>
              {v.members.map((m) => (
                <tr key={m.id} className="border-b border-zinc-100/80 last:border-b-0">
                  <td className={cn(td, "font-bold")}>
                    {m.name}
                    {m.isMe ? <span className="ml-1.5 text-[10px] font-semibold text-zinc-500">(you)</span> : null}
                  </td>
                  <td className={td}>
                    <StatusTag tone={STATUS_TONES[m.attendance]}>{ATTENDANCE_STATUS_LABELS[m.attendance]}</StatusTag>
                  </td>
                  <td className={td}>{m.roster ? ROSTER_STATUS_LABELS[m.roster] : "—"}</td>
                  <td className={cn(td, "tabular-nums")}>{m.open}</td>
                  <td className={cn(td, "tabular-nums", m.overdue ? "font-bold text-rose-700" : "")}>{m.overdue}</td>
                  <td className={cn(td, "tabular-nums")}>
                    {m.metrics.calls} · {m.metrics.callMin ?? "—"}
                  </td>
                  <td className={cn(td, "tabular-nums")}>{m.metrics.meetings}</td>
                  <td className={cn(td, "tabular-nums")}>
                    {m.metrics.booked} · {m.metrics.lost}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>

      <PanelCard title={`Team's open leads · ${v.openTotal}`}>
        {v.openLeads.length === 0 ? (
          <p className="text-xs text-zinc-500">No open leads.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <thead className="bg-zinc-100">
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className={th}>Lead</th>
                  <th scope="col" className={th}>Stage</th>
                  <th scope="col" className={th}>Agent</th>
                  <th scope="col" className={th}>Next follow-up</th>
                  <th scope="col" className={th}>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {v.openLeads.map((l) => (
                  <tr key={l.id} className="border-b border-zinc-100/80 last:border-b-0">
                    <td className={td}>
                      {l.mine ? (
                        <Link href={`/dashboard/leads/${l.id}`} className="font-bold text-brand hover:underline">
                          {l.name}
                        </Link>
                      ) : (
                        <span className="font-bold">{l.name}</span>
                      )}
                      <span className="ml-1.5 text-zinc-500">{l.code}</span>
                    </td>
                    <td className={td}>{STAGE_LABELS[l.stage]}</td>
                    <td className={td}>{l.ownerName}</td>
                    <td className={cn(td, l.nextFollowUpAt && new Date(l.nextFollowUpAt) < new Date(v.today) ? "text-rose-700" : "")}>{l.nextFollowUpAt ? formatDateTime(l.nextFollowUpAt) : "—"}</td>
                    <td className={td}>{formatDateTime(l.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {v.openTotal > v.openLeads.length ? <p className="mt-2 text-[11px] text-zinc-500">Showing the {v.openLeads.length} with the earliest follow-ups.</p> : null}
        <p className="mt-2 text-[11px] text-zinc-500">You can open your own leads. Other agents&apos; leads are listed for your overview only.</p>
      </PanelCard>
    </PageStack>
  );
}
