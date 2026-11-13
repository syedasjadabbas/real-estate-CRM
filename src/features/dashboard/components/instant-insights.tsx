"use client";

import { MapPin, Video } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, Eyebrow, Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented";
import { MiniStat, SummaryTile } from "@/components/ui/stat";
import { cn } from "@/lib/cn";
import { formatDate, formatInt, formatTime, NO_VALUE, percentOf } from "@/lib/format";
import type { DashboardData, MeetingFormat, RangeKey, TargetLine } from "../types";
import { compactRangeOptions } from "./range-options";

const formatColors: Record<MeetingFormat["color"], { stroke: string; bg: string; bar: string }> = {
  sky: { stroke: "stroke-sky-600", bg: "bg-sky-600", bar: "bg-sky-600" },
  orange: { stroke: "stroke-orange-600", bg: "bg-orange-600", bar: "bg-orange-600" },
};

function Donut({ formats, centerLabel }: { formats: MeetingFormat[]; centerLabel: string }) {
  const total = formats.reduce((sum, f) => sum + f.count, 0);
  const radius = 15.9155; // circumference = 100
  const segments = formats.map((f, i) => {
    const pct = (f.count / total) * 100;
    const start = formats.slice(0, i).reduce((sum, prev) => sum + (prev.count / total) * 100, 0);
    return { ...f, pct, start };
  });
  return (
    <figure className="relative mx-auto size-40" aria-label={`${total} meetings by format`}>
      {/* Mirrored so segments run counter-clockwise from 3 o'clock, as in the reference. */}
      <svg viewBox="0 0 42 42" className="size-full -scale-y-100">
        <circle cx="21" cy="21" r={radius} fill="none" className="stroke-zinc-100" strokeWidth="6" />
        {segments.map((s) => {
          const length = Math.max(0, s.pct - 0.8);
          return (
            <circle
              key={s.id}
              cx="21"
              cy="21"
              r={radius}
              fill="none"
              strokeWidth="6"
              className={formatColors[s.color].stroke}
              strokeDasharray={`${length} ${100 - length}`}
              strokeDashoffset={-s.start}
            />
          );
        })}
      </svg>
      <figcaption className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-black tabular-nums">{total}</span>
        <span className="text-[9px] font-black tracking-[0.1em] text-zinc-400 uppercase">{centerLabel}</span>
      </figcaption>
    </figure>
  );
}

function TargetColumn({ title, lines }: { title: string; lines: TargetLine[] }) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/50 p-2.5">
      <p className="px-1 pb-2 text-[9px] font-black tracking-[0.1em] text-zinc-500 uppercase">{title}</p>
      <div className="space-y-2">
        {lines.map((line) => (
          <div key={line.label} className="rounded-xl border border-zinc-200/80 bg-white px-2.5 py-2 shadow-hairline">
            <div className="flex items-center justify-between gap-2 text-[11px] leading-4">
              <span className="font-bold">{line.label}</span>
              <span className="font-black tabular-nums">
                {formatInt(line.actual)}
                <span className="font-semibold text-zinc-400">
                  {line.target ? ` / ${formatInt(line.target)}` : " · no target"}
                </span>
              </span>
            </div>
            <ProgressBar
              className="mt-1.5"
              value={line.target ? line.actual : 1}
              max={line.target ?? 1}
              label={`${line.label} progress`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** `own`: an agent's dashboard, which shows only their own score and targets (no team or project-wide panels). */
export function InstantInsights({ data, own = false }: { data: DashboardData; own?: boolean }) {
  const [range, setRange] = useState<RangeKey>("mtd");
  const { insights } = data;
  const mixTotal = data.meetingMix.reduce((sum, f) => sum + f.count, 0);
  const topFormat = [...data.meetingMix].sort((a, b) => b.count - a.count)[0];
  const activeFormats = data.meetingMix.filter((f) => f.count > 0).length;

  return (
    <div className="space-y-3.5">
      <Card className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm leading-5 font-black">Instant Insights</h2>
          <Badge>Live</Badge>
        </div>
        <p className="text-[11px] leading-[16.5px] text-zinc-600">
          {own ? "Your score and targets" : "Charts · Sales Teams MTD"} ·{" "}
          {data.insightsUpdatedAt
            ? `${formatDate(data.insightsUpdatedAt)}, ${formatTime(data.insightsUpdatedAt)}`
            : "waiting for data"}
        </p>
      </Card>

      {own ? null : (
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <MiniStat
          label="Teams"
          value={formatInt(data.teamSummary?.teams)}
          caption={
            data.teamSummary?.avgScore == null
              ? `Avg score ${NO_VALUE}`
              : `Avg score ${data.teamSummary.avgScore}${data.teamSummary.provisional ? " · provisional" : ""}`
          }
        />
        <MiniStat
          label="Meetings 30D"
          value={formatInt(insights?.meetings30d)}
          caption={insights ? `30d ${insights.meetings30d} · 6mo ${insights.meetings6m}` : NO_VALUE}
        />
        <MiniStat label="Team meetings" value={formatInt(insights?.teamMeetings)} caption="MTD period" />
        <MiniStat label="Bookings" value={formatInt(insights?.bookings)} caption="Across top teams" />
      </div>
      )}

      <div className={own ? "grid grid-cols-1 gap-3.5" : "grid grid-cols-1 gap-3.5 lg:grid-cols-3"}>
        <Panel
          title={data.scoreScope === "own" ? "Your performance score" : "Team performance scores"}
          badge={<Badge>Score</Badge>}
          description={data.scoreScope === "own" ? "Your own assignment score; provisional while your history is small" : "Composite score by sales team"}
        >
          {data.teamScores.length === 0 ? (
            <EmptyState>No team scores.</EmptyState>
          ) : (
            <ul className="space-y-2.5">
              {data.teamScores.map((t) => (
                <li key={t.id}>
                  <div className="flex justify-between text-xs font-bold">
                    <span>{t.label}</span>
                    <span className="tabular-nums">{t.count}</span>
                  </div>
                  <ProgressBar className="mt-1" value={t.count} max={100} label={`${t.label} score`} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {own ? null : (
          <>
        <Panel title="Meetings vs bookings" badge={<Badge>Output</Badge>} description="Top teams throughput">
          {data.teamOutput.length === 0 ? (
            <EmptyState>No team output.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {data.teamOutput.map((t) => (
                <li key={t.id} className="flex justify-between rounded-xl border border-zinc-200/80 px-3 py-2 text-xs font-bold">
                  <span>{t.label}</span>
                  <span className="tabular-nums text-zinc-600">
                    {t.meetings} meetings · {t.bookings} bookings
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Meeting mix (30d)" badge={<Badge>Mix</Badge>} description="Share by meeting format">
          {mixTotal === 0 ? (
            <EmptyState>No meetings in the last 30 days.</EmptyState>
          ) : (
            <div className="space-y-4">
              <Donut formats={data.meetingMix} centerLabel="30d" />
              <ul className="space-y-3">
                {data.meetingMix.map((f) => (
                  <li key={f.id}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 font-bold">
                        <span className={cn("size-2 rounded-full", formatColors[f.color].bg)} />
                        {f.label}
                      </span>
                      <span className="font-black tabular-nums">
                        {f.count}
                        <span className="ml-2 font-semibold text-zinc-400">{percentOf(f.count, mixTotal)}%</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-zinc-100">
                      <div
                        className={cn("h-full rounded-full", formatColors[f.color].bar)}
                        style={{ width: `${percentOf(f.count, mixTotal)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              {topFormat ? (
                <p className="rounded-xl bg-zinc-50 px-3 py-2 text-[11px] font-semibold text-zinc-600">
                  Dominant format: {topFormat.label} ({topFormat.count}).
                </p>
              ) : null}
            </div>
          )}
        </Panel>
          </>
        )}
      </div>

      <div className={own ? "grid grid-cols-1 gap-5" : "grid grid-cols-1 gap-5 xl:grid-cols-2"}>
        <Card className="self-start p-4">
          <Eyebrow className="text-xs leading-4">My Targets</Eyebrow>
          <p className="mt-0.5 text-[11px] text-zinc-600">Daily, weekly, and monthly goals vs your activity.</p>
          {data.targets ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TargetColumn title="Today" lines={data.targets.today} />
              <TargetColumn title="This week" lines={data.targets.week} />
              <TargetColumn title="This month" lines={data.targets.month} />
            </div>
          ) : (
            <EmptyState size="sm" className="mt-3">
              Targets appear here once you are signed in.
            </EmptyState>
          )}
        </Card>

        {own ? null : (
        <Card className="overflow-hidden">
          <CardHeader
            title="Meetings Distribution"
            description="Pipeline & calendar mix by type"
            actions={
              <SegmentedControl compact label="Meetings range" options={compactRangeOptions} value={range} onChange={setRange} />
            }
            className="border-b-0 pb-0"
          />
          <div className="p-4">
            <div className="grid grid-cols-3 gap-2">
              <SummaryTile label="Total" value={mixTotal ? formatInt(mixTotal) : NO_VALUE} className="rounded-xl border border-zinc-200/80 bg-white" />
              <SummaryTile label="Top format" value={topFormat?.label ?? NO_VALUE} accent className="rounded-xl border border-zinc-200/80 bg-white" />
              <SummaryTile
                label="Active"
                value={
                  <>
                    {mixTotal ? activeFormats : NO_VALUE}
                    <span className="text-xs font-medium text-zinc-400">/{data.meetingMix.length || NO_VALUE}</span>
                  </>
                }
                className="rounded-xl border border-zinc-200/80 bg-white"
              />
            </div>
            <div className="mt-3 space-y-2">
              {mixTotal === 0 ? (
                <EmptyState size="sm">No meetings in this range.</EmptyState>
              ) : (
                data.meetingMix.map((f) => {
                  const Icon = f.color === "sky" ? Video : MapPin;
                  return (
                    <div key={f.id} className="rounded-xl border border-zinc-200/80 px-2.5 py-2 shadow-hairline">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 font-bold">
                          <Icon aria-hidden="true" className={cn("size-3.5", f.color === "sky" ? "text-sky-600" : "text-brand")} />
                          {f.label}
                        </span>
                        <span className="flex items-center gap-1.5 font-black tabular-nums">
                          {f.count}
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600">
                            {percentOf(f.count, mixTotal)}%
                          </span>
                        </span>
                      </div>
                      <ProgressBar className="mt-1.5" size="xs" value={f.count} max={mixTotal} label={f.label} />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </Card>
        )}
      </div>
    </div>
  );
}
