import { CalendarDays } from "lucide-react";
import { canOpenLeaveAdmin } from "@/modules/leave/service";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { HolidayCalendar } from "@/features/hr/components/holiday-calendar";
import { AddHolidayButton, HolidayNotices, HolidayRowActions } from "@/features/hr/components/holiday-editor";
import { HolidaysToolbar } from "@/features/hr/components/holidays-toolbar";
import { HrTabs } from "@/features/hr/components/hr-tabs";
import { formatListedOn } from "@/features/inventory/format";
import { formatDateTime } from "@/features/leads/format";
import { flattenParams, withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { canViewEmployees } from "@/modules/employees/policy";
import { canManageHolidays, canViewHolidays } from "@/modules/holidays/policy";
import { listHolidays } from "@/modules/holidays/service";
import { HOLIDAY_SCOPE_LABELS, weekdayOf, type HolidaySort } from "@/modules/holidays/validation";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Holidays" };

const COLUMNS: { label: string; sort?: HolidaySort }[] = [
  { label: "Date", sort: "date" },
  { label: "Day" },
  { label: "Holiday", sort: "name" },
  { label: "Scope" },
  { label: "Region" },
  { label: "Last updated" },
];

export default async function HolidaysPage({ searchParams }: PageProps<"/dashboard/hr/holidays">) {
  const actor = await requirePageUser();
  if (!canViewHolidays(actor)) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const canManage = canManageHolidays(actor);
  const data = await listHolidays(getDb(), actor, params);
  const view = params.view === "calendar" ? "calendar" : "list";
  const { year, rows, tiles, next, today, regions } = data;
  const filtered = Boolean(params.q || params.scope || params.region);
  // New holidays default to today in the current year, otherwise to 1 January of the year shown.
  const defaultDate = today.startsWith(String(year)) ? today : `${year}-01-01`;
  const sortHref = (key: HolidaySort) =>
    withParams("/dashboard/hr/holidays", params, { sort: key, dir: data.query.sort === key && data.query.dir === "asc" ? "desc" : "asc" });
  const columns = canManage ? [...COLUMNS, { label: "Actions" }] : COLUMNS;

  return (
    <PageStack>
      <PageHeader
        title="Holidays"
        description={canManage ? "Company-wide and regional holidays. Add, edit or remove dates for the calendar." : "Company-wide and regional holidays (view only)."}
        icon={CalendarDays}
      />
      <HrTabs active="holidays" showEmployees={canViewEmployees(actor)} showHolidays showLeave={canOpenLeaveAdmin(actor)} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label={`Holidays ${year}`} value={formatInt(tiles.total)} caption={`${formatInt(tiles.upcoming)} still ahead`} />
        <MiniStat label="Company-wide" value={formatInt(tiles.company)} caption="Apply to everyone" />
        <MiniStat label="Regional" value={formatInt(tiles.regional)} caption="One region each" />
        <MiniStat
          label="Next holiday"
          value={<span className="block truncate text-sm leading-[18px]">{next ? next.name : "—"}</span>}
          caption={next ? `${formatListedOn(next.date)}${next.region ? ` · ${next.region}` : ""}` : "None on file"}
        />
      </div>
      <HolidayNotices>
        <HolidaysToolbar
          params={params}
          year={year}
          view={view}
          total={rows.length}
          regions={regions}
          action={canManage ? <AddHolidayButton regions={regions} defaultDate={defaultDate} /> : null}
        />
        {view === "calendar" ? (
          <>
            <p className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-zinc-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded bg-brand" aria-hidden="true" /> Company-wide
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded bg-sky-100 ring-1 ring-sky-300" aria-hidden="true" /> Regional only
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded ring-2 ring-zinc-900/70" aria-hidden="true" /> Today
              </span>
              {filtered ? <span className="text-zinc-500">Filters apply to the calendar.</span> : null}
            </p>
            <HolidayCalendar year={year} rows={rows} today={today} />
          </>
        ) : rows.length === 0 ? (
          <EmptyState>{filtered ? "No holidays match your search or filters." : `No holidays on file for ${year}.`}</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-hairline">
            <div className="relative max-h-[600px] overflow-auto">
              <table className="w-full min-w-max border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-zinc-100">
                  <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                    {columns.map((c) => (
                      <th
                        key={c.label}
                        scope="col"
                        aria-sort={c.sort && c.sort === data.query.sort ? (data.query.dir === "asc" ? "ascending" : "descending") : undefined}
                        className="px-3 py-4 whitespace-nowrap"
                      >
                        {c.sort ? (
                          <Link href={sortHref(c.sort)} className="inline-flex items-center gap-1.5 hover:text-zinc-900" aria-label={`Sort by ${c.label}`}>
                            {c.label}
                            <span aria-hidden="true" className="flex flex-col text-[7px] leading-[7px]">
                              <span className={cn(data.query.sort === c.sort && data.query.dir === "asc" ? "text-brand" : "text-zinc-300")}>▲</span>
                              <span className={cn(data.query.sort === c.sort && data.query.dir === "desc" ? "text-brand" : "text-zinc-300")}>▼</span>
                            </span>
                          </Link>
                        ) : (
                          c.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={cn("border-b border-zinc-100/80 last:border-b-0 hover:bg-zinc-50/60", r.date < today && "text-zinc-500")}>
                      <td className="px-3 py-3 font-bold whitespace-nowrap tabular-nums">{formatListedOn(r.date)}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{weekdayOf(r.date)}</td>
                      <td className="max-w-[320px] px-3 py-3 font-semibold break-words whitespace-normal text-zinc-900">{r.name}</td>
                      <td className="px-3 py-3">
                        <StatusTag tone={r.scope === "company" ? "brand" : "sky"}>{HOLIDAY_SCOPE_LABELS[r.scope]}</StatusTag>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{r.region ?? "—"}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-zinc-600">
                        {r.updatedBy ?? "—"} · {formatDateTime(r.updatedAt)}
                      </td>
                      {canManage ? (
                        <td className="px-3 py-3">
                          <HolidayRowActions holiday={{ id: r.id, date: r.date, name: r.name, scope: r.scope, region: r.region }} regions={regions} />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </HolidayNotices>
      <p className="text-[11px] text-zinc-500">
        Holidays are shown for reference. How they affect leave day counts depends on the leave policy, which is still to be confirmed by the client.
      </p>
    </PageStack>
  );
}
