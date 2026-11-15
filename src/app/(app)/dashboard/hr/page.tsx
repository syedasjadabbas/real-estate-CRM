import { ArrowRight, CalendarDays, Clock, Plane, Users } from "lucide-react";
import { canOpenLeaveAdmin } from "@/modules/leave/service";
import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/card";
import { RestrictedState } from "@/components/ui/empty-state";
import { findNavItem } from "@/config/navigation";
import { HrTabs } from "@/features/hr/components/hr-tabs";
import { canViewAttendance } from "@/modules/attendance/service";
import { canViewEmployees } from "@/modules/employees/policy";
import { canViewHolidays } from "@/modules/holidays/policy";
import { requirePageUser } from "@/server/auth/current-user";
import { asc, ilike, or } from "drizzle-orm";
import { buttonClasses } from "@/components/ui/button";
import { flattenParams } from "@/features/leads/url";
import { canViewProfiles } from "@/modules/people/profile";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { getDb } from "@/server/db";
import { users } from "@/server/db/schema";

export const metadata: Metadata = { title: "HR" };

type Module = { eyebrow: string; title: string; description: string; icon: LucideIcon; href: string | null; note: string };

function ModuleCard({ m }: { m: Module }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase">{m.eyebrow}</span>
        <span className="inline-flex size-8 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <m.icon aria-hidden="true" className="size-4" />
        </span>
      </span>
      <span className="mt-2 block text-base font-black tracking-[-0.025em]">{m.title}</span>
      <span className="mt-1 block text-xs text-zinc-600">{m.description}</span>
      <span className="mt-4 flex items-center gap-1.5 text-xs font-bold">
        {m.href ? (
          <span className="inline-flex items-center gap-1 text-brand">
            Open <ArrowRight aria-hidden="true" className="size-3.5" />
          </span>
        ) : (
          <Badge tone="neutral">{m.note}</Badge>
        )}
      </span>
    </>
  );
  const cls = "flex h-full flex-col rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-hairline";
  return m.href ? (
    <Link href={m.href} className={`${cls} transition-colors hover:border-brand/40 hover:bg-brand-50/30`}>
      {body}
    </Link>
  ) : (
    <div className={`${cls} bg-zinc-50/60`}>{body}</div>
  );
}

/** Reference "People & time off" overview: module cards. Employees, Holidays, Leave and Attendance (15 Nov 2026). */
/**
 * "Find employee" (owner, 15 Nov 2026): type a name or email and jump to anyone's work profile or
 * HR record, instead of going through Employees, Teams or Performance.
 */
async function FindEmployee({ q, canProfile }: { q: string; canProfile: boolean }) {
  const term = q.trim();
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const people = term
    ? await getDb()
        .select({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status })
        .from(users)
        .where(or(ilike(users.name, like), ilike(users.email, like)))
        .orderBy(asc(users.name))
        .limit(10)
    : [];
  return (
    <Panel title="Find employee" description="Type a name or email to open someone's work profile or HR record.">
      <form method="get" action="/dashboard/hr" className="flex flex-wrap items-center gap-2 py-2" role="search" aria-label="Find employee">
        <input
          type="search"
          name="q"
          defaultValue={term}
          placeholder="e.g. Ali or ali@company.com"
          maxLength={100}
          autoComplete="off"
          className="h-10 min-w-0 flex-1 rounded-xl border border-zinc-200/80 bg-white px-3 text-sm font-medium shadow-hairline focus:border-brand/50 focus:outline-none"
        />
        <button type="submit" className={buttonClasses({ variant: "primary", size: "lg" })}>
          Search
        </button>
        {term ? (
          <Link href="/dashboard/hr" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            Clear
          </Link>
        ) : null}
      </form>
      {term ? (
        people.length === 0 ? (
          <p className="pb-2 text-xs text-zinc-500">No one matches “{term}”.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 pb-2">
            {people.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <span className="min-w-0">
                  <span className="font-bold">{p.name}</span>
                  <span className="text-zinc-500">
                    {" "}
                    · {ROLE_LABELS[p.role as Role] ?? p.role} · {p.email}
                    {p.status === "active" ? "" : " · inactive"}
                  </span>
                </span>
                <span className="flex gap-2">
                  {canProfile && (p.role === "agent" || p.role === "admin") ? (
                    <Link href={`/dashboard/people/${p.id}`} className={buttonClasses({ variant: "primary", size: "md" })}>
                      Work profile
                    </Link>
                  ) : null}
                  <Link href={`/dashboard/hr/employees/${p.id}`} className={buttonClasses({ variant: "secondary", size: "md" })}>
                    HR record
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Panel>
  );
}

export default async function HrPage({ searchParams }: PageProps<"/dashboard/hr">) {
  const actor = await requirePageUser();
  const q = flattenParams(await searchParams).q ?? "";
  const item = findNavItem("/dashboard/hr")!;
  // HR is for HR, Admins and Super Admins; agents and accountants see their leave in My workplace.
  if (item.roles && !item.roles.includes(actor.role)) return <RestrictedState />;
  const holidays = canViewHolidays(actor);
  const employees = canViewEmployees(actor);
  const modules: Module[] = [
    {
      eyebrow: "Directory",
      title: "Employees",
      description: "Roles, departments, contacts, and profiles.",
      icon: Users,
      href: employees ? "/dashboard/hr/employees" : null,
      note: "HR, admins and managers",
    },
    {
      eyebrow: "Calendar",
      title: "Holidays",
      description: "Company-wide and regional holidays.",
      icon: CalendarDays,
      href: holidays ? "/dashboard/hr/holidays" : null,
      note: "HR, admins and managers",
    },
    {
      eyebrow: "Time off",
      title: "Leave",
      description: "Requests, approvals, and balances. Request your own leave from My Workplace.",
      icon: Plane,
      href: canOpenLeaveAdmin(actor) ? "/dashboard/hr/leave" : "/dashboard/workspace",
      note: "Approvers, HR and admins",
    },
    {
      eyebrow: "Attendance",
      title: "Attendance",
      description: "Daily check-in sheet, monthly summary and office hours. Everyone checks in from My Workplace.",
      icon: Clock,
      href: canViewAttendance(actor) ? "/dashboard/hr/attendance" : "/dashboard/workspace",
      note: "HR and admins",
    },
  ];
  return (
    <PageStack>
      <PageHeader title="People & time off" description="Employee records, holiday calendar, leave requests, and activity. Payroll is managed under Finance." icon={item.icon} />
      <HrTabs showAttendance={canViewAttendance(actor)} active="overview" showEmployees={employees} showHolidays={holidays} showLeave={canOpenLeaveAdmin(actor)} />
      {canViewEmployees(actor) ? <FindEmployee q={q} canProfile={canViewProfiles(actor)} /> : null}
      <Panel title="Modules" description="Open a section to manage people and time off.">
        <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2 xl:grid-cols-4">
          {modules.map((m) => (
            <ModuleCard key={m.title} m={m} />
          ))}
        </div>
      </Panel>
    </PageStack>
  );
}
