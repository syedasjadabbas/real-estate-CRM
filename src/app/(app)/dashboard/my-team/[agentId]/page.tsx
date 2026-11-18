import { ArrowLeft, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { STATUS_TONES } from "@/features/attendance/components/check-in-card";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime, formatDuration } from "@/features/leads/format";
import { flattenParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { ATTENDANCE_STATUS_LABELS } from "@/modules/attendance/rules";
import { STAGE_LABELS } from "@/modules/leads/constants";
import { addDays } from "@/modules/teams/dates";
import { teamAgentKpis } from "@/modules/teams/team-agent";
import { periodLabel } from "@/modules/targets/period";
import { TARGET_METRICS } from "@/modules/targets/service";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Agent KPIs" };

const field = "h-9 rounded-xl border border-zinc-200/80 bg-white px-3 text-xs font-semibold shadow-hairline focus:border-brand/50 focus:outline-none";
const pctText = (v: number | null) => (v === null ? "—" : `${v}%`);
const PERIOD_NAMES: Record<string, string> = { daily: "Today", weekly: "This week", monthly: "This month", custom: "Own dates" };

/** "↑ 3 vs 5–11 Nov" style comparison with the same length of time just before the range. */
function change(now: number | null, before: number | null, unit = "") {
  if (now === null || before === null) return undefined;
  const d = Math.round((now - before) * 10) / 10;
  if (d === 0) return "Same as the period before";
  return `${d > 0 ? "↑" : "↓"} ${Math.abs(d)}${unit} vs the period before`;
}

/** One agent's KPIs for their Team Lead (owner, 16 Nov 2026), opened from My team. View-only. */
export default async function TeamAgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageUser();
  if (actor.role !== "agent" || !actor.ledTeamIds?.length) return <RestrictedState />;
  const { agentId } = await params;
  const q = flattenParams(await searchParams);
  const k = await teamAgentKpis(getDb(), actor, agentId, q);
  const m = k.metrics;
  const self = `/dashboard/my-team/${k.person.id}`;
  const presets = [
    { label: "Today", from: k.today },
    { label: "7 days", from: addDays(k.today, -6) },
    { label: "30 days", from: addDays(k.today, -30) },
    { label: "This month", from: `${k.today.slice(0, 7)}-01` },
  ];
  const open = k.pipeline.filter((p) => p.stage !== "booked" && p.stage !== "lost_lead");

  return (
    <PageStack>
      <PageHeader
        title={`${k.person.name} · KPIs`}
        icon={UserRound}
        description={`${k.team.name}. A short view of this agent's results for the dates below. View-only: lead details, coaching notes and approvals stay with Admins.`}
        actions={
          <Link href={`/dashboard/my-team?${new URLSearchParams({ team: k.team.id, from: k.range.from, to: k.range.to })}`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            My team
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        {presets.map((r) => {
          const on = k.range.from === r.from && k.range.to === k.today;
          return (
            <Link key={r.label} href={`${self}?${new URLSearchParams({ from: r.from, to: k.today })}`} aria-current={on ? "true" : undefined} className={cn("rounded-lg border px-3 py-1.5 text-xs font-bold", on ? "border-brand bg-brand text-white" : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50")}>
              {r.label}
            </Link>
          );
        })}
        <form method="get" action={self} className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-zinc-500" aria-label="Custom dates">
          <input type="date" name="from" aria-label="From" defaultValue={k.range.from} max={k.today} className={field} />
          to
          <input type="date" name="to" aria-label="To" defaultValue={k.range.to} max={k.today} className={field} />
          <button type="submit" className={buttonClasses({ variant: "secondary", size: "md" })}>
            Show
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MiniStat label="Calls" value={String(m.calls)} caption={change(m.calls, k.previous.calls) ?? `${m.callMin ?? "—"} min talk time`} />
        <MiniStat label="Meetings held" value={String(m.meetings)} caption={change(m.meetings, k.previous.meetings) ?? "In range"} />
        <MiniStat label="Won" value={String(m.booked)} caption={change(m.booked, k.previous.booked) ?? "Leads booked, in range"} />
        <MiniStat label="Win %" value={pctText(m.winPct)} caption={`${m.booked} won · ${m.lost} lost`} />
        <MiniStat label="Follow-up %" value={pctText(m.fuPct)} caption={`${m.fuDone} of ${m.fuDue} done on time`} />
        <MiniStat label="Score" value={k.score ? `${k.score.score}${k.score.provisional ? " prov." : ""}` : "—"} caption="0–100: follow-ups and conversion" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <PanelCard title="Right now">
          <dl className="grid grid-cols-2 gap-3 text-xs">
            {[
              ["Open leads", open.reduce((n, p) => n + p.count, 0)],
              ["Overdue follow-ups", k.followUps.overdue],
              ["Follow-ups due later today", k.followUps.today],
              ["Bookings made (range)", k.bookings.made],
              ["Closed Won (range)", k.bookings.won],
              ["Avg first touch (range)", formatDuration(m.avgFirstTouchMs)],
              ["Call review (range)", m.reviewAvg === null ? "—" : `${m.reviewAvg.toFixed(1)} / 5 · ${m.reviewCount}`],
              ["Rank in team (by won)", k.team.size > 1 ? `${k.team.rank} of ${k.team.size}` : "—"],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-zinc-200/80 px-3 py-2">
                <dt className="text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">{label}</dt>
                <dd className={cn("mt-0.5 text-sm font-bold tabular-nums", label === "Overdue follow-ups" && Number(value) > 0 && "text-rose-700")}>{value}</dd>
              </div>
            ))}
          </dl>
          {k.team.size > 1 ? (
            <p className="mt-3 text-[11px] text-zinc-500">
              Team average in the range: {k.team.avg.calls} calls, {k.team.avg.meetings} meetings, {k.team.avg.booked} won per agent.
            </p>
          ) : null}
        </PanelCard>

        <PanelCard title="Pipeline now">
          <ul className="space-y-1.5 text-xs">
            {k.pipeline.map((p) => (
              <li key={p.stage} className="flex items-center justify-between gap-3">
                <span className="text-zinc-700">{STAGE_LABELS[p.stage]}</span>
                <span className={cn("font-bold tabular-nums", p.count === 0 && "text-zinc-400")}>{p.count}</span>
              </li>
            ))}
          </ul>
        </PanelCard>

        <PanelCard title="Targets now">
          {k.targets.length === 0 ? (
            <p className="text-xs text-zinc-500">No targets are running for this agent today.</p>
          ) : (
            <div className="space-y-3">
              {k.targets.map((t) => (
                <div key={`${t.period}-${t.start}`}>
                  <p className="mb-1 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">
                    {PERIOD_NAMES[t.period]}
                    {t.period === "custom" ? ` · ${periodLabel(t.period, t.start, t.end)}` : ""}
                  </p>
                  <ul className="space-y-1 text-xs">
                    {TARGET_METRICS.filter((x) => t.goals![x.key] > 0).map((x) => {
                      const goal = t.goals![x.key];
                      const got = t.achieved[x.key];
                      return (
                        <li key={x.key} className="flex items-center justify-between gap-3">
                          <span className="text-zinc-700">{x.label}</span>
                          <span className={cn("tabular-nums", got >= goal ? "font-bold text-emerald-700" : "")}>
                            {got.toLocaleString("en-PK")} / {goal.toLocaleString("en-PK")} {got >= goal ? "· Met" : `· ${Math.round((got / goal) * 100)}%`}
                          </span>
                        </li>
                      );
                    })}
                    {t.custom.map((g) => (
                      <li key={g.name} className="flex items-center justify-between gap-3">
                        <span className="text-zinc-700">{g.name}</span>
                        <span className={cn("tabular-nums", g.met ? "font-bold text-emerald-700" : "")}>
                          {g.achieved} / {g.goal}
                          {g.met ? " · Met" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </PanelCard>

        <PanelCard title="Attendance">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-zinc-700">Today</span>
            <StatusTag tone={STATUS_TONES[k.attendance.status]}>{ATTENDANCE_STATUS_LABELS[k.attendance.status]}</StatusTag>
            {k.attendance.checkIn ? <span className="text-zinc-500">checked in {formatDateTime(k.attendance.checkIn)}</span> : null}
          </div>
          <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
            {[
              ["Working days", k.attendance.month.workingDays],
              ["Present", k.attendance.month.present + k.attendance.month.late],
              ["Late", k.attendance.month.late],
              ["Absent", k.attendance.month.absent],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-zinc-200/80 px-2 py-1.5 text-center">
                <dt className="text-[10px] font-semibold text-zinc-500">{label}</dt>
                <dd className={cn("text-sm font-bold tabular-nums", label === "Absent" && Number(value) > 0 && "text-rose-700", label === "Late" && Number(value) > 0 && "text-amber-700")}>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11px] text-zinc-500">This month so far.</p>
        </PanelCard>
      </div>
    </PageStack>
  );
}
