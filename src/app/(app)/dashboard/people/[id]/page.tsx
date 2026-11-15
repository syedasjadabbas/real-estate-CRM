import { CheckCircle2, Download, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { STATUS_TONES } from "@/features/attendance/components/check-in-card";
import { FilterList } from "@/features/people/components/filter-list";
import { CoachingNotes, PrintButton } from "@/features/people/components/profile-client";
import { formatListedOn, formatPrice } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { flattenParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { ATTENDANCE_STATUS_LABELS, formatMinutes } from "@/modules/attendance/rules";
import { STAGE_LABELS } from "@/modules/leads/constants";
import { canViewProfiles, employeeProfile, type EmployeeProfile } from "@/modules/people/profile";
import { formatClock } from "@/modules/recordings/validation";
import { addDays } from "@/modules/teams/dates";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Employee profile" };

const ACTIVITY_LABELS: Record<string, string> = {
  created: "Created a lead",
  note: "Added a note",
  stage_change: "Moved a lead",
  follow_up_scheduled: "Scheduled a follow-up",
  follow_up_done: "Completed a follow-up",
  assignment: "Assignment",
  update: "Changed lead details",
  review: "Wrote a review",
  regenerated: "Recorded a re-inquiry",
  lost_requested: "Asked to mark lost",
  lost_decided: "Decided a lost request",
  meeting: "Meeting",
  file_uploaded: "Uploaded a file",
  file_deleted: "Deleted a file",
  client_linked: "Linked a client",
  verification: "Verification",
};

/** ↑ / ↓ against the previous period. */
function Trend({ now, before, suffix = "" }: { now: number; before: number; suffix?: string }) {
  if (now === before) return <span className="text-[11px] font-bold text-zinc-400">= before</span>;
  const up = now > before;
  return (
    <span className={cn("text-[11px] font-bold", up ? "text-brand" : "text-rose-600")} title={`Previous period: ${before}${suffix}`}>
      {up ? "↑" : "↓"} from {before}
      {suffix}
    </span>
  );
}

/** Calls and meetings per day, as small bars (at most 31 days). */
function DailyChart({ days }: { days: { date: string; calls: number; meetings: number }[] }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.calls, d.meetings)));
  return (
    <div>
      <div className="flex h-28 items-end gap-0.5" role="img" aria-label="Calls and meetings per day">
        {days.map((d) => (
          <div key={d.date} className="flex h-full flex-1 items-end justify-center gap-px" title={`${d.date}: ${d.calls} calls, ${d.meetings} meetings`}>
            <div className="w-1/2 rounded-t bg-sky-500" style={{ height: `${(d.calls / max) * 100}%`, minHeight: d.calls ? 2 : 0 }} />
            <div className="w-1/2 rounded-t bg-brand" style={{ height: `${(d.meetings / max) * 100}%`, minHeight: d.meetings ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        <span>{days[0]?.date.slice(5)}</span>
        <span className="flex gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-sky-500" /> Calls
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-brand" /> Meetings
          </span>
        </span>
        <span>{days[days.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

function Section({ title, children, className, id }: { title: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={cn("scroll-mt-20", className)}>
      <PanelCard title={title} className="h-full">
        {children}
      </PanelCard>
    </div>
  );
}

/** Quick links to each part of the long profile (16 Nov 2026). */
const JUMPS = [
  ["compare", "Team"],
  ["pipeline", "Pipeline"],
  ["follow-ups", "Follow-ups"],
  ["targets", "Targets"],
  ["attendance", "Attendance"],
  ["calls", "Calls"],
  ["overdue", "Overdue"],
  ["lost", "Lost & sources"],
  ["notes", "Notes"],
  ["activity", "Activity"],
] as const;

function Row({ label, value, tone }: { label: string; value: ReactNode; tone?: "amber" | "rose" | "brand" }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-100 py-1.5 text-xs last:border-b-0">
      <span className="text-zinc-600">{label}</span>
      <span className={cn("font-black tabular-nums", tone === "amber" && "text-amber-700", tone === "rose" && "text-rose-700", tone === "brand" && "text-brand")}>{value}</span>
    </div>
  );
}

function Targets({ lines, title }: { lines: EmployeeProfile["targets"]["today"]; title: string }) {
  const set = lines.filter((l) => l.target !== null);
  return (
    <div>
      <p className="mb-1 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{title}</p>
      {set.length === 0 ? (
        <p className="text-xs text-zinc-500">No target set</p>
      ) : (
        set.map((l) => (
          <Row
            key={l.label}
            label={l.label}
            value={
              <span className="inline-flex items-center gap-1">
                {l.actual} / {l.target}
                {l.met ? <CheckCircle2 aria-label="Met" className="size-3.5 text-brand" /> : null}
              </span>
            }
          />
        ))
      )}
    </div>
  );
}

/** Admins and Super Admins: everything about one employee's work (owner, 15 Nov 2026). */
export default async function EmployeeProfilePage({ params, searchParams }: PageProps<"/dashboard/people/[id]">) {
  const actor = await requirePageUser();
  if (!canViewProfiles(actor)) return <RestrictedState />;
  const { id } = await params;
  const query = flattenParams(await searchParams);
  let p: EmployeeProfile;
  try {
    p = await employeeProfile(getDb(), actor, id, query);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const m = p.metrics;
  const base = `/dashboard/people/${p.person.id}`;
  const monthStart = `${p.today.slice(0, 7)}-01`;
  const presets = [
    { label: "Today", from: p.today },
    { label: "7 days", from: addDays(p.today, -6) },
    { label: "30 days", from: addDays(p.today, -30) },
    { label: "This month", from: monthStart },
  ];
  const isPreset = (from: string) => p.range.from === from && p.range.to === p.today;
  const rangeLabel = p.range.from === p.range.to ? formatListedOn(p.range.from) : `${formatListedOn(p.range.from)} – ${formatListedOn(p.range.to)}`;
  const openLeads = p.pipeline.filter((s) => s.stage !== "booked" && s.stage !== "lost_lead").reduce((n, s) => n + s.count, 0);

  return (
    <PageStack>
      {/* Printing / saving as PDF shows only the profile, not the menu and header (16 Nov 2026). */}
      <style>{"@media print { aside, header, nav[aria-label], form[method=get] { display: none !important; } body { background: #fff !important; } }"}</style>
      <PageHeader
        title={p.person.name}
        icon={UserRound}
        description={
          <>
            {ROLE_LABELS[p.person.role as Role]} · {p.person.email}
            {p.profile?.designation ? ` · ${p.profile.designation}` : ""}
            {p.profile?.department ? ` · ${p.profile.department}` : ""}
            {p.profile?.joiningDate ? ` · joined ${formatListedOn(p.profile.joiningDate)}` : ""}
            {p.person.status !== "active" ? " · inactive account" : ""}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {/* The whole record for the chosen dates (15 Nov 2026). */}
            <a href={`/api/v1/people/${p.person.id}/export?from=${p.range.from}&to=${p.range.to}`} download className={buttonClasses({ variant: "primary", size: "md" })}>
              <Download aria-hidden="true" className="size-4" />
              Download record (CSV)
            </a>
            <PrintButton />
            <Link href={`/dashboard/hr/employees/${p.person.id}`} className={buttonClasses({ variant: "secondary", size: "md" })}>
              HR record
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {p.teams.length === 0 ? <StatusTag tone="neutral">No team</StatusTag> : null}
        {p.teams.map((t) => (
          <StatusTag key={t.id} tone={t.isLead ? "brand" : "neutral"}>
            {t.name}
            {t.isLead ? " · Team Lead" : ""}
            {t.admin ? ` · admin ${t.admin}` : ""}
            {t.isActive ? "" : " · inactive"}
          </StatusTag>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {presets.map((r) => (
          <Link
            key={r.label}
            href={`${base}?from=${r.from}&to=${p.today}`}
            aria-current={isPreset(r.from) ? "true" : undefined}
            className={cn("rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors", isPreset(r.from) ? "border-brand bg-brand text-white" : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50")}
          >
            {r.label}
          </Link>
        ))}
        <form method="get" action={base} className="flex flex-wrap items-center gap-2">
          <input type="date" name="from" defaultValue={p.range.from} max={p.today} aria-label="From" className="h-8 rounded-lg border border-zinc-200/80 bg-white px-2 text-xs font-semibold" />
          <input type="date" name="to" defaultValue={p.range.to} max={p.today} aria-label="To" className="h-8 rounded-lg border border-zinc-200/80 bg-white px-2 text-xs font-semibold" />
          <button type="submit" className={buttonClasses({ variant: "secondary", size: "md" })}>
            Show
          </button>
        </form>
        <span className="text-xs font-bold text-zinc-600">{rangeLabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MiniStat label="Calls" value={<>{m.calls} <Trend now={m.calls} before={p.previous.calls} /></>} caption={`${m.callsVerified} verified · ${m.callsQualified} qualified`} />
        <MiniStat label="Call minutes" value={m.callMin === null ? "—" : String(m.callMin)} caption={`${m.callsTimed} of ${m.calls} timed`} />
        <MiniStat label="Meetings held" value={<>{m.meetings} <Trend now={m.meetings} before={p.previous.meetings} /></>} caption="Completed in range" />
        <MiniStat label="Bookings" value={<>{p.bookings.made} <Trend now={p.bookings.made} before={p.previous.bookingsMade} /></>} caption={p.bookings.made ? formatPrice(p.bookings.value) : "Made in range"} />
        <MiniStat label="Win rate" value={<>{m.winPct === null ? "—" : `${m.winPct}%`} {m.winPct !== null && p.previous.winPct !== null ? <Trend now={m.winPct} before={p.previous.winPct} suffix="%" /> : null}</>} caption={`${m.booked} won · ${m.lost} lost`} />
        <MiniStat label="Score" value={p.score ? String(Math.round(p.score.score)) : "—"} caption={p.score?.provisional ? "Provisional" : "Assignment score"} />
      </div>

      <nav aria-label="Profile sections" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1 print:hidden">
        {JUMPS.filter(([id]) => id !== "notes" || actor.id !== p.person.id).map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-bold text-zinc-700 hover:border-brand hover:text-brand">
            {label}
          </a>
        ))}
      </nav>

      <p className="-mt-3 text-[11px] text-zinc-500">
        ↑ / ↓ compare with the same number of days just before: {formatListedOn(p.previous.from)}
        {p.previous.from !== p.previous.to ? ` – ${formatListedOn(p.previous.to)}` : ""}.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section id="compare" title={p.teamCompare ? `Compared with ${p.teamCompare.team}` : "Compared with the team"}>
          {p.teamCompare ? (
            <>
              <p className="mb-2 text-xs font-bold">
                Rank {p.teamCompare.rank} of {p.teamCompare.size} agents <span className="font-normal text-zinc-500">(by leads won, then meetings, then calls)</span>
              </p>
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1 text-xs">
                <span className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Figure</span>
                <span className="text-right text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">This agent</span>
                <span className="text-right text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Team avg</span>
                {[
                  ["Calls", m.calls, p.teamCompare.avg.calls],
                  ["Meetings held", m.meetings, p.teamCompare.avg.meetings],
                  ["Leads won", m.booked, p.teamCompare.avg.booked],
                  ["Win rate", m.winPct === null ? "—" : `${m.winPct}%`, p.teamCompare.avg.winPct === null ? "—" : `${p.teamCompare.avg.winPct}%`],
                ].map(([label, mine, avg]) => (
                  <div key={String(label)} className="contents">
                    <span className="border-t border-zinc-100 py-1 text-zinc-600">{label}</span>
                    <span className="border-t border-zinc-100 py-1 text-right font-black tabular-nums">{mine}</span>
                    <span className="border-t border-zinc-100 py-1 text-right text-zinc-600 tabular-nums">{avg}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-zinc-500">Not in an active team with other agents.</p>
          )}
        </Section>

        <Section title="Daily activity">
          <DailyChart days={p.daily} />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Section id="pipeline" title={`Pipeline now · ${openLeads} open`}>
          {p.pipeline.map((s) => (
            <Row key={s.stage} label={STAGE_LABELS[s.stage]} value={s.count} />
          ))}
          <Row label="Never touched (open)" value={p.untouched} tone={p.untouched ? "amber" : undefined} />
          <Link href={`/dashboard/leads?owner=${p.person.id}`} className="mt-2 inline-block text-xs font-bold text-brand hover:underline">
            Open their leads →
          </Link>
        </Section>

        <Section id="follow-ups" title="Follow-ups">
          <Row label="Overdue now" value={p.followUps.overdue} tone={p.followUps.overdue ? "rose" : undefined} />
          <Row label="Due later today" value={p.followUps.today} />
          <Row label="Upcoming" value={p.followUps.upcoming} />
          <p className="mt-3 mb-1 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">In range</p>
          <Row label="Due" value={m.fuDue} />
          <Row label="Done" value={`${m.fuDone}${m.fuPct === null ? "" : ` (${m.fuPct}%)`}`} />
          <Row label="Done on time" value={p.followUps.doneOnTime} tone="brand" />
          <Row label="Done late" value={p.followUps.doneLate} tone={p.followUps.doneLate ? "amber" : undefined} />
        </Section>

        <Section title="Leads, meetings and bookings">
          <Row label="Leads assigned in range" value={m.leads} />
          <Row label="Still open of those" value={m.open} />
          <Row label="Avg time to first touch" value={m.avgFirstTouchMs === null ? "—" : formatMinutes(Math.round(m.avgFirstTouchMs / 60_000))} />
          <Row label="Meetings held" value={m.meetings} />
          <Row label="Bookings made" value={p.bookings.made} />
          <Row label="Closed won in range" value={p.bookings.won} tone="brand" />
          <Row label="Open bookings now" value={p.bookings.open} />
          <Row label="CRM sign-ins" value={m.signIns} />
        </Section>

        <Section id="targets" title="Targets">
          <div className="space-y-3">
            <Targets title="Today" lines={p.targets.today} />
            <Targets title="This week" lines={p.targets.week} />
            <Targets title="This month" lines={p.targets.month} />
          </div>
        </Section>

        <Section id="attendance" title="Attendance and leave">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <StatusTag tone={STATUS_TONES[p.attendance.status]}>{ATTENDANCE_STATUS_LABELS[p.attendance.status]}</StatusTag>
            <span className="text-zinc-600 tabular-nums">
              Today in {p.attendance.checkIn ?? "—"} · out {p.attendance.checkOut ?? "—"}
            </span>
          </div>
          <p className="mb-1 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">This month</p>
          <Row label="Working days so far" value={p.attendance.month.workingDays} />
          <Row label="Present" value={p.attendance.month.present + p.attendance.month.late} />
          <Row label="Late" value={p.attendance.month.late} tone={p.attendance.month.late ? "amber" : undefined} />
          <Row label="Absent" value={p.attendance.month.absent} tone={p.attendance.month.absent ? "rose" : undefined} />
          <Row label="Hours worked" value={formatMinutes(p.attendance.month.minutes)} />
          <Link href={`/dashboard/hr/attendance/${p.person.id}`} className="mt-2 inline-block text-xs font-bold text-brand hover:underline">
            Day-by-day attendance →
          </Link>
          <p className="mt-3 mb-1 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Leave {p.leave.year}</p>
          <Row label="Remaining / allowance" value={`${p.leave.remaining} / ${p.leave.allowance}`} />
          <Row label="Taken · pending" value={`${p.leave.granted} · ${p.leave.pending}`} />
        </Section>

        <Section id="calls" title={`Call recordings in range · ${m.calls}`}>
          <FilterList
            empty="No recordings in this range."
            tags={["Under 30s", "30s to 1 min", "Over 1 min"]}
            tagLabel="Any length"
            items={p.recordings.map((r) => ({
              id: r.id,
              text: `${r.leadName} ${r.leadCode}`,
              tag: r.durationSec === null ? undefined : r.durationSec < 30 ? "Under 30s" : r.durationSec <= 60 ? "30s to 1 min" : "Over 1 min",
              node: (
                <div className="flex items-center justify-between gap-3 py-2 text-xs">
                  <Link href={`/dashboard/leads/${r.leadId}`} className="min-w-0 truncate font-semibold text-brand hover:underline">
                    {r.leadName} <span className="font-normal text-zinc-500">· {r.leadCode}</span>
                  </Link>
                  <span className="shrink-0 text-zinc-500 tabular-nums">
                    {r.durationSec === null ? "length unknown" : formatClock(r.durationSec)} · {formatDateTime(r.createdAt)}
                  </span>
                </div>
              ),
            }))}
          />
          {m.calls > p.recordings.length ? <p className="mt-1 text-[11px] text-zinc-500">Only the latest {p.recordings.length} can be searched here.</p> : null}
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section id="overdue" title={`Overdue follow-ups · ${p.followUps.overdue}`}>
          <FilterList
            empty="Nothing overdue."
            step={5}
            tags={["Over a week late", "1 to 7 days late", "Under a day late"]}
            tagLabel="Any delay"
            placeholder="Search lead, code or note"
            items={p.overdueList.map((o) => {
              const late = (p.asOf.getTime() - o.dueAt.getTime()) / 86_400_000;
              return {
                id: o.id,
                text: `${o.leadName} ${o.leadCode} ${o.note ?? ""}`,
                tag: late > 7 ? "Over a week late" : late >= 1 ? "1 to 7 days late" : "Under a day late",
                node: (
                <div className="py-2 text-xs">
                  <Link href={`/dashboard/leads/${o.leadId}`} className="font-semibold text-brand hover:underline">
                    {o.leadName}
                  </Link>
                  <span className="text-zinc-500"> · {o.leadCode}</span>
                  <span className="block text-[11px] text-rose-700">Was due {formatDateTime(o.dueAt)}</span>
                  {o.note ? <span className="block text-[11px] text-zinc-500">{o.note}</span> : null}
                </div>
                ),
              };
            })}
          />
          {p.followUps.overdue > p.overdueList.length ? <p className="mt-1 text-[11px] text-zinc-500">Only the oldest {p.overdueList.length} can be searched here.</p> : null}
        </Section>

        <Section id="lost" title="Why leads were lost">
          {p.lostByReason.length === 0 ? <p className="text-xs text-zinc-500">No leads lost in this range.</p> : p.lostByReason.map((r) => <Row key={r.reason} label={r.reason} value={r.count} />)}
        </Section>

        <Section title="Lead sources (created in range)">
          {p.bySource.length === 0 ? (
            <p className="text-xs text-zinc-500">No leads in this range.</p>
          ) : (
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1 text-xs">
              {["Source", "Leads", "Won", "Lost"].map((h, i) => (
                <span key={h} className={cn("text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase", i > 0 && "text-right")}>
                  {h}
                </span>
              ))}
              {p.bySource.map((r) => (
                <div key={r.source} className="contents">
                  <span className="border-t border-zinc-100 py-1">{r.source}</span>
                  <span className="border-t border-zinc-100 py-1 text-right tabular-nums">{r.leads}</span>
                  <span className="border-t border-zinc-100 py-1 text-right font-bold text-brand tabular-nums">{r.won}</span>
                  <span className="border-t border-zinc-100 py-1 text-right text-zinc-600 tabular-nums">{r.lost}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {actor.id !== p.person.id ? (
        <Section id="notes" title={`Coaching notes · ${p.notes.length}`}>
          <CoachingNotes userId={p.person.id} notes={p.notes} meId={actor.id} canDeleteAny={actor.role === "super_admin"} canWrite />
        </Section>
      ) : null}

      <Section id="activity" title="Recent activity">
        <FilterList
          empty="No activity recorded yet."
          tags={[...new Set(p.activity.map((a) => ACTIVITY_LABELS[a.type] ?? a.type))]}
          tagLabel="All activity"
          items={p.activity.map((a) => {
              const d = (a.data ?? {}) as Record<string, unknown>;
              const detail =
                a.type === "stage_change" && d.to ? ` to ${STAGE_LABELS[d.to as keyof typeof STAGE_LABELS] ?? String(d.to)}` : a.type === "file_uploaded" && d.kind === "call_recording" ? " (call recording)" : "";
              return {
                id: a.id,
                text: `${a.leadName} ${a.leadCode}`,
                tag: ACTIVITY_LABELS[a.type] ?? a.type,
                node: (
                <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                  <span>
                    <span className="font-semibold">{ACTIVITY_LABELS[a.type] ?? a.type}</span>
                    {detail} ·{" "}
                    <Link href={`/dashboard/leads/${a.leadId}`} className="font-semibold text-brand hover:underline">
                      {a.leadName}
                    </Link>
                  </span>
                  <span className="text-zinc-500 tabular-nums">{formatDateTime(a.createdAt)}</span>
                </div>
                ),
              };
            })}
        />
      </Section>
    </PageStack>
  );
}
