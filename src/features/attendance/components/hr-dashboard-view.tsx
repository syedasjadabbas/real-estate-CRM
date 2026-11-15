import { AlarmClock, ArrowRight, CalendarDays, Clock, Plane, UserCheck, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { brand } from "@/config/brand";
import { PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { MiniStat } from "@/components/ui/stat";
import { formatListedOn } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { LEAVE_TYPE_LABELS } from "@/modules/leave/rules";
import type { HrDashboardData } from "@/modules/attendance/hr-dashboard";

function Section({ title, href, linkLabel, children }: { title: string; href?: string; linkLabel?: string; children: ReactNode }) {
  return (
    <PanelCard title={title}>
      <div className="space-y-3">
        {children}
        {href ? (
          <Link href={href} className="inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline">
            {linkLabel ?? "Open"} <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </PanelCard>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl bg-zinc-50 px-3 py-4 text-center text-xs font-semibold text-zinc-500">{children}</p>;

function Names({ items }: { items: { key: string; name: string; note?: ReactNode }[] }) {
  return (
    <ul className="divide-y divide-zinc-100">
      {items.map((i) => (
        <li key={i.key} className="flex items-center justify-between gap-3 py-2 text-xs first:pt-0 last:pb-0">
          <span className="min-w-0 truncate font-semibold">{i.name}</span>
          {i.note ? <span className="shrink-0 text-zinc-500 tabular-nums">{i.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

const range = (a: string, b: string) => (a === b ? formatListedOn(a) : `${formatListedOn(a)} – ${formatListedOn(b)}`);

/** HR's home page (owner, 15 Nov 2026): people and time off, not sales analytics. */
export function HrDashboardView({ data, user }: { data: HrDashboardData; user: { name: string; email: string; roleLabel: string } }) {
  const { attendance: a, settings } = data;
  const present = (a.counts.present ?? 0) + (a.counts.late ?? 0);
  const working = a.total - (a.counts.on_leave ?? 0) - (a.counts.holiday ?? 0) - (a.counts.weekend ?? 0);

  return (
    <PageStack>
      <div className="relative overflow-hidden rounded-3xl border border-zinc-200/80 bg-linear-to-br from-white via-brand-50/40 to-brand-50/50 p-6 shadow-hairline md:p-8">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-white px-3 py-1 text-[11px] font-black tracking-[0.1em] text-brand uppercase shadow-hairline">
            <span className="size-2 rounded-full bg-brand" />
            {brand.productLabel}
          </span>
          <span className="inline-flex items-center rounded-full bg-zinc-950 px-3 py-1 text-[11px] font-bold text-white">{user.roleLabel}</span>
        </div>
        <h1 className="mt-2 text-3xl leading-none font-black tracking-[-0.025em] md:text-5xl">
          People <span className="text-brand">Dashboard</span>
        </h1>
        <p className="mt-2 font-medium text-zinc-700">
          Signed in as <span className="font-bold text-zinc-950">{user.email}</span> · <span className="font-semibold text-brand">{user.name}</span>
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {formatListedOn(data.today)} · Office hours {settings.officeStart}–{settings.officeEnd}, late after {settings.lateAfter}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MiniStat label="Present today" value={`${present} / ${Math.max(working, 0)}`} caption="Checked in / expected" />
        <MiniStat label="Late today" value={String(a.counts.late ?? 0)} caption={`After ${settings.lateAfter}`} />
        <MiniStat label="Not checked in" value={String(a.counts.not_yet ?? 0)} caption="Working today" />
        <MiniStat label="On leave today" value={String(a.counts.on_leave ?? 0)} caption="Approved leave" />
        <MiniStat label="Leave to decide" value={String(data.pendingLeaveTotal)} caption={data.cancellations ? `+ ${data.cancellations} cancellation${data.cancellations === 1 ? "" : "s"}` : "Waiting for you"} />
        <MiniStat label="Active staff" value={String(data.headcount.accounts + data.headcount.noLogin)} caption={`${data.headcount.noLogin} without CRM login`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Section title={`Leave waiting for your decision · ${data.pendingLeaveTotal}`} href="/dashboard/hr/leave" linkLabel="Open leave">
          {data.pendingLeave.length === 0 ? (
            <Empty>Nothing to decide.</Empty>
          ) : (
            <Names items={data.pendingLeave.map((r) => ({ key: r.id, name: r.userName, note: `${LEAVE_TYPE_LABELS[r.type]} · ${range(r.startDate, r.endDate)} · ${r.days}d` }))} />
          )}
        </Section>

        <Section title={`Not checked in yet · ${a.notCheckedIn.length}`} href="/dashboard/hr/attendance" linkLabel="Open daily sheet">
          {a.notCheckedIn.length === 0 ? <Empty>Everyone expected today has checked in.</Empty> : <Names items={a.notCheckedIn.map((p) => ({ key: p.userId, name: p.name }))} />}
          {a.late.length ? (
            <div className="border-t border-zinc-100 pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black tracking-[0.1em] text-amber-700 uppercase">
                <AlarmClock aria-hidden="true" className="size-3.5" /> Late today
              </p>
              <Names items={a.late.map((p) => ({ key: p.userId, name: p.name, note: p.checkIn }))} />
            </div>
          ) : null}
        </Section>

        <Section title={`Missing check-outs · ${data.missingCheckOuts.length}`} href="/dashboard/hr/attendance" linkLabel="Correct on the daily sheet">
          {data.missingCheckOuts.length === 0 ? (
            <Empty>No missing check-outs in the last 30 days.</Empty>
          ) : (
            <Names items={data.missingCheckOuts.map((m) => ({ key: `${m.userId}-${m.date}`, name: m.name, note: `${formatListedOn(m.date)} · in ${m.checkIn}` }))} />
          )}
        </Section>

        <Section title={`Away this week · ${data.away.length}`} href="/dashboard/hr/leave" linkLabel="All leave">
          {data.away.length === 0 ? (
            <Empty>Nobody is on leave from today to {formatListedOn(data.weekEnd)}.</Empty>
          ) : (
            <Names items={data.away.map((l, i) => ({ key: `${l.userId}-${l.startDate}-${i}`, name: l.name, note: `${LEAVE_TYPE_LABELS[l.type]} · ${range(l.startDate, l.endDate)}` }))} />
          )}
        </Section>

        <Section title="Upcoming holidays" href="/dashboard/hr/holidays" linkLabel="Holiday calendar">
          {data.holidays.length === 0 ? (
            <Empty>No upcoming holidays added.</Empty>
          ) : (
            <Names
              items={data.holidays.map((h) => ({
                key: h.id,
                name: `${h.name}${h.region ? ` (${h.region})` : ""}`,
                note: `${formatListedOn(h.date)} · ${h.daysAway === 0 ? "today" : `in ${h.daysAway}d`}`,
              }))}
            />
          )}
        </Section>

        <Section title="This month" href="/dashboard/hr/attendance?view=month" linkLabel="Monthly summary">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="mb-2 text-[10px] font-black tracking-[0.1em] text-amber-700 uppercase">Most late</p>
              {data.month.topLate.length ? <Names items={data.month.topLate.map((r) => ({ key: r.userId, name: r.name, note: r.n }))} /> : <p className="text-xs text-zinc-500">None</p>}
            </div>
            <div>
              <p className="mb-2 text-[10px] font-black tracking-[0.1em] text-rose-700 uppercase">Most absent</p>
              {data.month.topAbsent.length ? <Names items={data.month.topAbsent.map((r) => ({ key: r.userId, name: r.name, note: r.n }))} /> : <p className="text-xs text-zinc-500">None</p>}
            </div>
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { href: "/dashboard/hr/employees", label: "Employee records", icon: Users, note: `${data.headcount.accounts} with CRM login · ${data.headcount.joinersThisMonth} joined this month` },
          { href: "/dashboard/hr/attendance", label: "Attendance", icon: Clock, note: "Daily sheet, monthly summary, office hours" },
          { href: "/dashboard/hr/leave", label: "Leave", icon: Plane, note: "Requests, approvals and balances" },
          { href: "/dashboard/hr/holidays", label: "Holidays", icon: CalendarDays, note: "Company and regional calendar" },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-hairline transition-colors hover:border-brand/40 hover:bg-brand-50/30">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <l.icon aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-black">{l.label}</span>
              <span className="block truncate text-[11px] text-zinc-500">{l.note}</span>
            </span>
          </Link>
        ))}
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <UserCheck aria-hidden="true" className="size-3.5" />
        <StatusTag tone="neutral">HR view</StatusTag> Sales analytics are for sales roles; HR sees people and time off here.
      </p>
    </PageStack>
  );
}
