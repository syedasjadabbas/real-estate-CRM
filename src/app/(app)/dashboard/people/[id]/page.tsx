import { CheckCircle2, UserRound } from "lucide-react";
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

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <PanelCard title={title} className={className}>
      {children}
    </PanelCard>
  );
}

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
          <Link href={`/dashboard/hr/employees/${p.person.id}`} className={buttonClasses({ variant: "secondary", size: "md" })}>
            HR record
          </Link>
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
        <MiniStat label="Calls" value={String(m.calls)} caption={`${m.callsVerified} verified · ${m.callsQualified} qualified`} />
        <MiniStat label="Call minutes" value={m.callMin === null ? "—" : String(m.callMin)} caption={`${m.callsTimed} of ${m.calls} timed`} />
        <MiniStat label="Meetings held" value={String(m.meetings)} caption="Completed in range" />
        <MiniStat label="Bookings" value={String(p.bookings.made)} caption={p.bookings.made ? formatPrice(p.bookings.value) : "Made in range"} />
        <MiniStat label="Win rate" value={m.winPct === null ? "—" : `${m.winPct}%`} caption={`${m.booked} won · ${m.lost} lost`} />
        <MiniStat label="Score" value={p.score ? String(Math.round(p.score.score)) : "—"} caption={p.score?.provisional ? "Provisional" : "Assignment score"} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Section title={`Pipeline now · ${openLeads} open`}>
          {p.pipeline.map((s) => (
            <Row key={s.stage} label={STAGE_LABELS[s.stage]} value={s.count} />
          ))}
          <Row label="Never touched (open)" value={p.untouched} tone={p.untouched ? "amber" : undefined} />
          <Link href={`/dashboard/leads?owner=${p.person.id}`} className="mt-2 inline-block text-xs font-bold text-brand hover:underline">
            Open their leads →
          </Link>
        </Section>

        <Section title="Follow-ups">
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

        <Section title="Targets">
          <div className="space-y-3">
            <Targets title="Today" lines={p.targets.today} />
            <Targets title="This week" lines={p.targets.week} />
            <Targets title="This month" lines={p.targets.month} />
          </div>
        </Section>

        <Section title="Attendance and leave">
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
          <p className="mt-3 mb-1 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Leave {p.leave.year}</p>
          <Row label="Remaining / allowance" value={`${p.leave.remaining} / ${p.leave.allowance}`} />
          <Row label="Taken · pending" value={`${p.leave.granted} · ${p.leave.pending}`} />
        </Section>

        <Section title={`Call recordings in range · ${m.calls}`}>
          {p.recordings.length === 0 ? (
            <p className="text-xs text-zinc-500">No recordings in this range.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {p.recordings.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <Link href={`/dashboard/leads/${r.leadId}`} className="min-w-0 truncate font-semibold text-brand hover:underline">
                    {r.leadName} <span className="font-normal text-zinc-500">· {r.leadCode}</span>
                  </Link>
                  <span className="shrink-0 text-zinc-500 tabular-nums">
                    {r.durationSec === null ? "length unknown" : formatClock(r.durationSec)} · {formatDateTime(r.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {m.calls > p.recordings.length ? <p className="mt-2 text-[11px] text-zinc-500">Showing the latest {p.recordings.length}.</p> : null}
        </Section>
      </div>

      <Section title="Recent activity">
        {p.activity.length === 0 ? (
          <p className="text-xs text-zinc-500">No activity recorded yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {p.activity.map((a) => {
              const d = (a.data ?? {}) as Record<string, unknown>;
              const detail =
                a.type === "stage_change" && d.to ? ` to ${STAGE_LABELS[d.to as keyof typeof STAGE_LABELS] ?? String(d.to)}` : a.type === "file_uploaded" && d.kind === "call_recording" ? " (call recording)" : "";
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                  <span>
                    <span className="font-semibold">{ACTIVITY_LABELS[a.type] ?? a.type}</span>
                    {detail} ·{" "}
                    <Link href={`/dashboard/leads/${a.leadId}`} className="font-semibold text-brand hover:underline">
                      {a.leadName}
                    </Link>
                  </span>
                  <span className="text-zinc-500 tabular-nums">{formatDateTime(a.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </PageStack>
  );
}
