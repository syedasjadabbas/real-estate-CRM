import { Plus, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams } from "@/features/leads/url";
import { TasksTable } from "@/features/tasks/components/tasks-table";
import { TasksToolbar } from "@/features/tasks/components/tasks-toolbar";
import { activeTaskFilters, TASK_FILTER_KEYS } from "@/features/tasks/url";
import { formatInt } from "@/lib/format";
import { canDoTask } from "@/modules/tasks/policy";
import { assigneeFilterUsers, listTasks, taskCounts, taskTeamOptions } from "@/modules/tasks/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Tasks" };

/** Card link: applies exactly `want`, or clears it when that is what is already applied. */
function cardLink(base: string, params: Record<string, string>, want: Record<string, string>) {
  const active = TASK_FILTER_KEYS.every((k) => (params[k] ?? "") === (want[k] ?? ""));
  return { active, href: active ? base : `${base}?${new URLSearchParams(want).toString()}` };
}

export default async function TasksPage({ searchParams }: PageProps<"/dashboard/tasks">) {
  const actor = await requirePageUser();
  if (!canDoTask(actor, "view")) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const db = getDb();
  const [result, assignees, counts, teams] = await Promise.all([
    listTasks(db, actor, params, undefined, { printablesOnly: true }),
    assigneeFilterUsers(db, actor),
    taskCounts(db, actor),
    taskTeamOptions(db, actor),
  ]);
  const card = (want: Record<string, string>) => cardLink("/dashboard/tasks", params, want);
  const filters = activeTaskFilters(params);

  return (
    <section className="space-y-6" aria-label="Tasks list">
      <PageHeader
        as="h2"
        title="Tasks"
        description="Proposals and payment plans to prepare, track and print for clients. Everyday to-dos are on the To-dos page."
        actions={
          <>
            {canDoTask(actor, "settings") ? (
              <Link href="/dashboard/tasks/settings" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                <Settings2 aria-hidden="true" className="size-4" />
                Proposal settings
              </Link>
            ) : null}
            {canDoTask(actor, "create") ? (
              <Link href="/dashboard/tasks/new" className={buttonClasses({ variant: "primary", size: "lg", className: "px-5" })}>
                <Plus aria-hidden="true" className="size-4" />
                Create task
              </Link>
            ) : null}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Open" value={formatInt(counts.open)} caption="Not started yet" {...card({ status: "open" })} />
        <MiniStat label="In progress" value={formatInt(counts.inProgress)} caption="Being worked on" {...card({ status: "in_progress" })} />
        <MiniStat label="Overdue" value={formatInt(counts.overdue)} caption="Past due, not done" className={counts.overdue ? "[&>p:nth-child(2)]:text-rose-700" : undefined} {...card({ overdue: "1" })} />
        <MiniStat label="Done" value={formatInt(counts.done)} caption="Completed" {...card({ status: "done" })} />
      </div>
      <TasksToolbar params={params} total={result.total} assignees={assignees} teams={teams} />
      <TasksTable rows={result.rows} params={params} emptyMessage={filters || params.q ? "No tasks match your search or filters." : canDoTask(actor, "create") ? "No tasks yet. Create one to get started." : "No tasks yet. Tasks assigned to you will appear here."} />
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} params={params} />
    </section>
  );
}
