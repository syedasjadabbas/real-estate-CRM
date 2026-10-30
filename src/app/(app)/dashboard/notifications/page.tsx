import { Bell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { Pagination } from "@/features/leads/components/pagination";
import { formatDateTime } from "@/features/leads/format";
import { flattenParams, withParams } from "@/features/leads/url";
import { MarkAllReadButton, ReminderForm } from "@/features/notifications/components/notification-controls";
import { cn } from "@/lib/cn";
import { listNotifications, reminderMinutes, type NotificationType } from "@/modules/notifications/service";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Notifications" };

const TYPE_LABELS: Record<NotificationType, string> = {
  lead_assigned: "Assigned",
  lead_regenerated: "Re-inquiry",
  lost_requested: "Lost request",
  lost_rejected: "Lost rejected",
  follow_up_soon: "Follow-up soon",
};

/** Notification history (FR-006): the user's own notifications only. */
export default async function NotificationsPage({ searchParams }: PageProps<"/dashboard/notifications">) {
  const actor = await requirePageUser();
  const all = flattenParams(await searchParams);
  const params: Record<string, string> = {};
  if (all.unread === "1") params.unread = "1";
  if (all.page) params.page = all.page;
  const db = getDb();
  const [data, minutes] = await Promise.all([listNotifications(db, actor, params), reminderMinutes(db)]);
  const isAdmin = actor.role === "super_admin" || actor.role === "admin";
  const tab = (label: string, unreadOnly: boolean) => {
    const active = Boolean(params.unread) === unreadOnly;
    return (
      <Link
        href={withParams("/dashboard/notifications", {}, { unread: unreadOnly ? "1" : null })}
        aria-current={active ? "page" : undefined}
        className={cn("rounded-lg px-3 py-1.5 text-xs font-bold transition-colors", active ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-white")}
      >
        {label}
      </Link>
    );
  };

  return (
    <PageStack>
      <PageHeader
        title="Notifications"
        description="Lead assignments, re-inquiries, lost requests and follow-up reminders for you."
        icon={Bell}
        actions={<MarkAllReadButton disabled={data.unread === 0} />}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <PanelCard title={`History · ${data.unread} unread`} className="min-w-0 self-start">
          <div role="group" aria-label="Show" className="mb-3 inline-flex rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-1 shadow-hairline">
            {tab("All", false)}
            {tab("Unread", true)}
          </div>
          {data.rows.length === 0 ? (
            <EmptyState size="sm">{params.unread ? "No unread notifications." : "No notifications yet."}</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {data.rows.map((n) => (
                <li key={n.id} className={cn("flex gap-3 py-3", !n.readAt && "font-semibold")}>
                  <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-zinc-200" : "bg-brand")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusTag tone={n.type === "follow_up_soon" ? "amber" : n.type === "lost_rejected" ? "rose" : "brand"}>{TYPE_LABELS[n.type]}</StatusTag>
                      <span className="text-[11px] text-zinc-500">{formatDateTime(n.createdAt)}</span>
                      {n.readAt ? null : <span className="text-[11px] font-bold text-brand">Unread</span>}
                    </div>
                    {n.link ? (
                      <Link href={n.link} className="mt-1 block text-sm break-words text-zinc-900 hover:text-brand hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      <p className="mt-1 text-sm break-words text-zinc-900">{n.title}</p>
                    )}
                    {n.body ? <p className="text-xs font-normal break-words text-zinc-600">{n.body}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Pagination page={data.page} pageCount={data.pageCount} total={data.total} params={params.unread ? { unread: "1" } : {}} />
          </div>
          <p className="mt-3 text-[11px] text-zinc-500">Opening a notification from the bell marks it read. The bell checks for new notifications about every 45 seconds.</p>
        </PanelCard>

        <PanelCard title="Follow-up reminders" className="min-w-0 self-start">
          <p className="mb-3 text-xs text-zinc-600">
            {minutes === null
              ? "Off. The reminder window has not been set: the client has not confirmed how long before a follow-up the reminder should appear."
              : `On: follow-up assignees get a reminder and a pop-up ${minutes} minutes before the follow-up is due.`}
          </p>
          {isAdmin ? <ReminderForm minutes={minutes} /> : <p className="text-[11px] text-zinc-500">Super admins and admins set the reminder window.</p>}
        </PanelCard>
      </div>
    </PageStack>
  );
}
