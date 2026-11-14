import { RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StagePill } from "@/features/leads/components/chips";
import { ScopeNotice, withLeadsAccess } from "@/features/leads/components/list-view";
import { Pagination } from "@/features/leads/components/pagination";
import { TodoDoneButton } from "@/features/leads/components/todo-done-button";
import { formatDateTime } from "@/features/leads/format";
import { flattenParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { leadTodos, TODO_BUCKETS, type TodoBucket } from "@/modules/leads/queries";
import { canDoMeeting } from "@/modules/meetings/policy";
import { overdueMeetings } from "@/modules/meetings/queries";
import { TASK_TYPE_LABELS } from "@/modules/tasks/constants";
import { canDoTask } from "@/modules/tasks/policy";
import { assignableUsers, openTodos, overdueTasks, taskFormOptions } from "@/modules/tasks/queries";
import { AddTodoForm, TodoList } from "@/features/tasks/components/todo-list";

export const metadata: Metadata = { title: "To-dos & overdues" };

/** Lead buckets plus FR-092 overdue tasks and FR-027 overdue meetings (shown to roles that work them). */
type Bucket = TodoBucket | "tasks" | "meetings" | "mine";

const GROUPS: { caption: string; buckets: { key: Bucket; label: string }[] }[] = [
  // Personal to-dos (owner, 14 Nov 2026): what used to be "General" tasks.
  { caption: "My list", buckets: [{ key: "mine", label: "My to-dos" }] },
  { caption: "Follow-ups", buckets: [{ key: "today", label: "Today" }, { key: "doneToday", label: "Done today" }] },
  {
    caption: "Upcoming",
    buckets: [
      { key: "tomorrow", label: "Tomorrow" },
      { key: "7d", label: "7 days" },
      { key: "15d", label: "15 days" },
      { key: "30d", label: "30 days" },
    ],
  },
  { caption: "Overdue", buckets: [{ key: "overdue", label: "Leads" }, { key: "tasks", label: "Tasks" }, { key: "meetings", label: "Meetings" }] },
  { caption: "Intake", buckets: [{ key: "unattended", label: "Unattended" }] },
];

const TITLES: Record<Bucket, string> = {
  today: "Follow-ups · Today",
  doneToday: "Follow-ups · Done today",
  tomorrow: "Follow-ups · Tomorrow",
  "7d": "Follow-ups · Next 7 days",
  "15d": "Follow-ups · Next 15 days",
  "30d": "Follow-ups · Next 30 days",
  overdue: "Overdue lead follow-ups",
  unattended: "New leads unattended 24h+",
  tasks: "Overdue tasks",
  meetings: "Overdue meetings",
  mine: "My to-dos",
};

export default function TodosPage({ searchParams }: PageProps<"/dashboard/leads/todos">) {
  return withLeadsAccess(async ({ actor, db, projectId }) => {
    const params = flattenParams(await searchParams);
    const showTasks = canDoTask(actor, "view");
    const showMeetings = canDoMeeting(actor, "view");
    const bucket: Bucket =
      showTasks && params.bucket === "tasks"
        ? "tasks"
        : showTasks && params.bucket === "mine"
          ? "mine"
          : showMeetings && params.bucket === "meetings"
          ? "meetings"
          : (TODO_BUCKETS as readonly string[]).includes(params.bucket)
            ? (params.bucket as TodoBucket)
            : "today";
    const listsTasks = bucket === "tasks";
    const listsMeetings = bucket === "meetings";
    const listsMine = bucket === "mine";
    const other = listsTasks || listsMeetings || listsMine;
    const [{ counts: leadCounts, items, page: leadPage, pageCount: leadPages }, overdue, lateMeetings, mine] = await Promise.all([
      leadTodos(db, actor, projectId, other ? "overdue" : bucket, undefined, other ? 1 : params.page),
      overdueTasks(db, actor, undefined, listsTasks ? params.page : 1),
      overdueMeetings(db, actor, undefined, listsMeetings ? params.page : 1),
      openTodos(db, actor, listsMine ? params.page : 1),
    ]);
    // The add form's choices: assignees (Admins: anyone; others: themselves) and the project's leads.
    const addForm = listsMine && canDoTask(actor, "create") ? await Promise.all([assignableUsers(db, actor), taskFormOptions(db, actor, projectId)]) : null;
    const { page, pageCount } = listsTasks ? overdue : listsMeetings ? lateMeetings : listsMine ? mine : { page: leadPage, pageCount: leadPages };
    const counts: Record<Bucket, number> = { ...leadCounts, tasks: overdue.count, meetings: lateMeetings.count, mine: mine.count };
    const groups = GROUPS.map((g) => ({ ...g, buckets: g.buckets.filter((b) => (b.key !== "tasks" && b.key !== "mine" ? true : showTasks) && (b.key !== "meetings" || showMeetings)) })).filter((g) => g.buckets.length > 0);

    return (
      <section className="space-y-6" aria-label="To-dos">
        <PageHeader
          as="h2"
          title="To-dos & overdues"
          description="Your own to-dos, today's lead follow-ups, follow-ups completed today, upcoming (tomorrow, 7 / 15 / 30 days), overdue lead follow-ups, tasks and meetings, and new leads unattended 24h+."
          actions={
            <Link href={`/dashboard/leads/todos?bucket=${bucket}`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Link>
          }
        />
        <ScopeNotice actor={actor} />
        <Card className="p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {groups.map((group) => (
              <div key={group.caption}>
                <p className="mb-2 text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase">{group.caption}</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.buckets.map((b) => {
                    const selected = b.key === bucket;
                    return (
                      <Link
                        key={b.key}
                        href={`/dashboard/leads/todos?bucket=${b.key}`}
                        aria-current={selected ? "true" : undefined}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors",
                          selected
                            ? "border-brand bg-brand text-white shadow-hairline"
                            : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50",
                          !selected && (b.key === "overdue" || b.key === "tasks" || b.key === "meetings") && counts[b.key] > 0 && "border-rose-200 text-rose-700",
                        )}
                      >
                        {b.label}
                        <span className={cn("rounded-md px-1.5 text-[10px] font-black", selected ? "bg-white/20" : "bg-zinc-100")}>
                          {counts[b.key]}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3.5">
            <h3 className="text-sm font-black">{TITLES[bucket]}</h3>
            <span className="text-[11px] font-semibold text-zinc-500">
              {counts[bucket]} in this view
            </span>
          </div>
          {bucket === "mine" ? (
            <div className="space-y-4 p-4">
              {addForm ? <AddTodoForm meId={actor.id} assignees={addForm[0]} leads={addForm[1].leads} /> : null}
              <TodoList rows={mine.rows} meId={actor.id} now={mine.generatedAt} />
            </div>
          ) : bucket === "meetings" ? (
            lateMeetings.rows.length === 0 ? (
              <div className="p-4">
                <EmptyState>No overdue meetings. You&apos;re all caught up.</EmptyState>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {lateMeetings.rows.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
                    <div className="min-w-0">
                      <Link href={`/dashboard/meetings/${m.id}`} className="font-bold break-words hover:text-brand hover:underline">
                        {m.title}
                      </Link>
                      <p className="text-zinc-600">Organizer: {m.organizerName}</p>
                    </div>
                    <span className="font-semibold text-rose-600">{formatDateTime(m.startsAt)}</span>
                  </li>
                ))}
              </ul>
            )
          ) : bucket === "tasks" ? (
            overdue.rows.length === 0 ? (
              <div className="p-4">
                <EmptyState>No overdue tasks. You&apos;re all caught up.</EmptyState>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {overdue.rows.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
                    <div className="min-w-0">
                      <Link href={`/dashboard/tasks/${t.id}`} className="font-bold break-words hover:text-brand hover:underline">
                        {t.title}
                      </Link>
                      <p className="text-zinc-600">
                        {TASK_TYPE_LABELS[t.type]} · {t.assigneeName}
                      </p>
                    </div>
                    {t.dueAt ? <span className="font-semibold text-rose-600">{formatDateTime(t.dueAt)}</span> : null}
                  </li>
                ))}
              </ul>
            )
          ) : items.length === 0 ? (
            <div className="p-4">
              <EmptyState>Nothing here. You&apos;re all caught up.</EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {items.map((item) => (
                <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
                  <div className="min-w-0">
                    <Link href={`/dashboard/leads/${item.leadId}`} className="font-bold hover:text-brand hover:underline">
                      {item.name} <span className="font-semibold tracking-[0.05em] text-zinc-500">{item.code}</span>
                    </Link>
                    <p className="text-zinc-600">
                      {item.phone} · {item.ownerName ?? "Unassigned"}
                      {item.note ? <span className="block text-zinc-700">{item.note}</span> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.dueAt ? (
                      <span className={cn("font-semibold", item.status === "pending" && new Date(item.dueAt) < new Date() ? "text-rose-600" : "text-zinc-700")}>
                        {formatDateTime(item.dueAt)}
                      </span>
                    ) : null}
                    <StagePill stage={item.stage} />
                    {item.followUpId && item.status === "pending" ? <TodoDoneButton followUpId={item.followUpId} /> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {pageCount > 1 ? (
            <div className="border-t border-zinc-100 px-4 py-3">
              <Pagination page={page} pageCount={pageCount} total={counts[bucket]} params={params} />
            </div>
          ) : null}
        </Card>
      </section>
    );
  });
}
