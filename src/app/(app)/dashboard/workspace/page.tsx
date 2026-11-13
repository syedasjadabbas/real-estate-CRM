import { Circle } from "lucide-react";
import { MyLeavePanel } from "@/features/leave/components/my-leave-panel";
import { businessToday } from "@/modules/bookings/today";
import { myLeave } from "@/modules/leave/service";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { Pagination } from "@/features/leads/components/pagination";
import { formatDateTime } from "@/features/leads/format";
import { flattenParams, withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { signinRetentionNote } from "@/modules/security/service";
import { getMyWorkplace } from "@/modules/workplace/service";
import { SIGNIN_COUNT_DAYS, SIGNIN_EVENT_LABELS, type SigninEvent } from "@/modules/workplace/validation";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "My workplace" };

const HREF = "/dashboard/workspace";
const EVENT_FILTERS: { label: string; value: SigninEvent | null }[] = [
  { label: "All", value: null },
  { label: "Sign-ins", value: "sign_in" },
  { label: "Sign-outs", value: "sign_out" },
];

/** My Workplace (FR-130): my leave and the user's own sign-in log. Upcoming holidays removed (owner, 13 Nov 2026). */
export default async function WorkspacePage({ searchParams }: PageProps<"/dashboard/workspace">) {
  const actor = await requirePageUser();
  const all = flattenParams(await searchParams);
  // Only the parameters this page understands; the user is always the signed-in actor.
  const params: Record<string, string> = {};
  if (all.event) params.event = all.event;
  if (all.page) params.page = all.page;
  const thisYear = Number(businessToday().slice(0, 4));
  const askedYear = Number(all.leaveYear);
  // My leave by calendar year (C-11); anything out of range shows this year.
  const leaveYear = Number.isInteger(askedYear) && askedYear >= 2000 && askedYear <= thisYear + 1 ? askedYear : thisYear;
  const db = getDb();
  const [{ holidays, signins }, retentionNote, leave] = await Promise.all([getMyWorkplace(db, actor, params), signinRetentionNote(db), myLeave(db, actor, leaveYear)]);
  const listParams: Record<string, string> = signins.query.event ? { event: signins.query.event } : {};

  return (
    <PageStack>
      <PageHeader title="My workplace" description="Your leave and CRM sign-in history (web sessions)." icon={Circle} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MiniStat label={`Leave · ${leave.year}`} value={`${leave.balance.remaining} / ${leave.balance.allowance}`} caption="Days remaining / allowance" />
        <MiniStat label="Sign-ins logged" value={formatInt(signins.recentSignins)} caption={`Last ${SIGNIN_COUNT_DAYS} days · not attendance`} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0 space-y-6">
          <MyLeavePanel
            balance={leave.balance}
            rows={leave.rows}
            today={holidays.today}
            years={leave.years.map((y) => ({ year: y, current: y === leave.year, href: `/dashboard/workspace?${new URLSearchParams({ ...params, ...(y === thisYear ? {} : { leaveYear: String(y) }) })}` }))}
          />
        </div>

        <PanelCard title="CRM Sign-in History" className="min-w-0 self-start">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black tracking-[0.2em] text-brand uppercase">Authentication activity</p>
              <p className="text-[11px] text-zinc-500">Recorded when you sign in or out of this CRM (password sessions).</p>
            </div>
            <div role="group" aria-label="Event" className="inline-flex rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-1 shadow-hairline">
              {EVENT_FILTERS.map((f) => {
                const active = (signins.query.event ?? null) === f.value;
                return (
                  <Link
                    key={f.label}
                    href={withParams(HREF, {}, { event: f.value })}
                    aria-current={active ? "true" : undefined}
                    className={cn("rounded-lg px-3 py-1.5 text-xs font-bold transition-colors", active ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-white")}
                  >
                    {f.label}
                  </Link>
                );
              })}
            </div>
          </div>

          {signins.rows.length === 0 ? (
            <EmptyState size="sm" className="mt-3">
              {signins.query.event ? "No entries of this type yet." : "No sign-ins recorded yet."}
            </EmptyState>
          ) : (
            <>
              <ul className="mt-3 divide-y divide-zinc-100 md:hidden">
                {signins.rows.map((r) => (
                  <li key={r.id} className="py-2.5 text-xs first:pt-0">
                    <div className="flex items-center justify-between gap-2">
                      <StatusTag tone={r.event === "sign_in" ? "brand" : "neutral"}>{SIGNIN_EVENT_LABELS[r.event]}</StatusTag>
                      <span className="tabular-nums text-zinc-600">{formatDateTime(r.at)}</span>
                    </div>
                    <p className="mt-1 break-words text-zinc-600">
                      <span className="font-bold text-zinc-700">IP (as recorded):</span> {r.ip ?? "—"}
                    </p>
                    <p className="break-words text-zinc-600" title={r.userAgent ?? undefined}>
                      <span className="font-bold text-zinc-700">Browser:</span> {r.browser}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-3 hidden overflow-x-auto rounded-xl border border-zinc-200/80 md:block">
                <table className="w-full min-w-max border-collapse text-left text-xs">
                  <thead className="bg-zinc-100">
                    <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                      <th scope="col" className="px-3 py-3">Event</th>
                      <th scope="col" className="px-3 py-3">Date &amp; time</th>
                      <th scope="col" className="px-3 py-3">IP (as recorded)</th>
                      <th scope="col" className="px-3 py-3">Browser</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signins.rows.map((r) => (
                      <tr key={r.id} className="border-b border-zinc-100/80 last:border-b-0 hover:bg-zinc-50/60">
                        <td className="px-3 py-2.5">
                          <StatusTag tone={r.event === "sign_in" ? "brand" : "neutral"}>{SIGNIN_EVENT_LABELS[r.event]}</StatusTag>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{formatDateTime(r.at)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{r.ip ?? "—"}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap" title={r.userAgent ?? undefined}>
                          {r.browser}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="mt-4">
            <Pagination page={signins.page} pageCount={signins.pageCount} total={signins.total} params={listParams} />
          </div>
          <p className="mt-3 text-[11px] text-zinc-500">
            This is a record of CRM sign-ins, not an attendance record: it is never used to work out hours, lateness or absences. IP addresses are recorded only
            from the server&apos;s trusted proxy and are shown as recorded. Sessions that expire on their own are not recorded as sign-outs, and failed sign-in
            attempts are not listed. {retentionNote}
          </p>
        </PanelCard>
      </div>
    </PageStack>
  );
}
