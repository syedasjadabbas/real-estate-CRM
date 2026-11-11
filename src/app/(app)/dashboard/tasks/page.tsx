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
import { activeTaskFilters } from "@/features/tasks/url";
import { formatInt } from "@/lib/format";
import { canDoTask } from "@/modules/tasks/policy";
import { assigneeFilterUsers, listTasks } from "@/modules/tasks/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: PageProps<"/dashboard/tasks">) {
  const actor = await requirePageUser();
  if (!canDoTask(actor, "view")) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const db = getDb();
  const [result, assignees] = await Promise.all([listTasks(db, actor, params), assigneeFilterUsers(db, actor)]);
  const filters = activeTaskFilters(params);

  return (
    <section className="space-y-6" aria-label="Tasks list">
      <PageHeader
        as="h2"
        title="Tasks"
        description="Sort, paginate, and filter tasks like other CRM tables."
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniStat label="Total tasks" value={formatInt(result.total)} caption="Matching filters" />
        <MiniStat label="Active filters" value={formatInt(filters)} caption={filters ? "Filters applied" : "No filters"} />
        <MiniStat label="On this page" value={formatInt(result.rows.length)} caption="Loaded rows" />
      </div>
      <TasksToolbar params={params} total={result.total} assignees={assignees} />
      <TasksTable rows={result.rows} params={params} emptyMessage={filters || params.q ? "No tasks match your search or filters." : "No tasks yet. Create one to get started."} />
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} params={params} />
    </section>
  );
}
