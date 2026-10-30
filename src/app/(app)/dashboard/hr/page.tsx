import { ArrowRight, CalendarDays, Clock, Plane, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/card";
import { findNavItem } from "@/config/navigation";
import { HrTabs } from "@/features/hr/components/hr-tabs";
import { canViewEmployees } from "@/modules/employees/policy";
import { canViewHolidays } from "@/modules/holidays/policy";
import { requirePageUser } from "@/server/auth/current-user";

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

/** Reference "People & time off" overview: module cards. Employees and Holidays are built; Leave follows; attendance is not available (Q-H2). */
export default async function HrPage() {
  const actor = await requirePageUser();
  const item = findNavItem("/dashboard/hr")!;
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
    { eyebrow: "Time off", title: "Leave", description: "Requests, approvals, and balances.", icon: Plane, href: null, note: "Not built yet" },
    {
      eyebrow: "Attendance",
      title: "Attendance — not available",
      description: "CRM sign-ins are authentication activity, not attendance. Attendance tracking waits on the client's requirements (Q-H2).",
      icon: Clock,
      href: null,
      note: "Pending client decision",
    },
  ];
  return (
    <PageStack>
      <PageHeader title="People & time off" description="Employee records, holiday calendar, leave requests, and activity. Payroll is managed under Finance." icon={item.icon} />
      <HrTabs active="overview" showEmployees={employees} showHolidays={holidays} />
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
