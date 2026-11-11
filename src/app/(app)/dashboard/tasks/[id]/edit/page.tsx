import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { toLocalInputValue } from "@/features/leads/format";
import { TaskForm } from "@/features/tasks/components/task-form";
import { businessToday } from "@/modules/bookings/today";
import { canDoTask } from "@/modules/tasks/policy";
import { getTaskDetail, taskFormOptions, type TaskDetail } from "@/modules/tasks/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getProjectScope } from "@/server/project-scope";

export const metadata: Metadata = { title: "Edit task" };

export default async function EditTaskPage({ params }: PageProps<"/dashboard/tasks/[id]/edit">) {
  const actor = await requirePageUser();
  if (!canDoTask(actor, "edit")) return <RestrictedState />;
  const { id } = await params;
  let detail: TaskDetail;
  try {
    detail = await getTaskDetail(getDb(), actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { task } = detail;
  const back = (
    <Link href={`/dashboard/tasks/${task.id}`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to task
    </Link>
  );
  if (!detail.canEditDetails) {
    return (
      <section className="space-y-6" aria-label="Edit task">
        <PageHeader as="h2" title="Edit task" actions={back} />
        <EmptyState className="bg-white">Only the Super Admin can edit a saved proposal.</EmptyState>
      </section>
    );
  }
  if (task.status === "cancelled") {
    return (
      <section className="space-y-6" aria-label="Edit task">
        <PageHeader as="h2" title="Edit task" actions={back} />
        <EmptyState className="bg-white">This task is cancelled. Set another status to reopen it before editing.</EmptyState>
      </section>
    );
  }
  const { activeProjectId } = await getProjectScope();
  // A link outside the actor's access is kept as is (not offered, not cleared).
  const options = await taskFormOptions(getDb(), actor, activeProjectId, { leadId: task.leadId, bookingId: task.bookingId });
  const leadId = task.leadId && options.leads.some((l) => l.id === task.leadId) ? task.leadId : "";
  const bookingId = task.bookingId && options.bookings.some((b) => b.id === task.bookingId) ? task.bookingId : "";
  if (!options.assignees.some((a) => a.id === task.assigneeId)) {
    options.assignees.unshift({ id: task.assigneeId, name: detail.assigneeName ?? "Current assignee", role: "agent" });
  }

  return (
    <section className="space-y-6" aria-label="Edit task">
      <PageHeader as="h2" title="Edit task" description={task.title} actions={back} />
      <TaskForm
        mode="edit"
        taskId={task.id}
        options={options}
        today={businessToday()}
        initial={{
          title: task.title,
          type: task.type,
          dueLocal: task.dueAt ? toLocalInputValue(task.dueAt) : "",
          assigneeId: task.assigneeId,
          leadId,
          bookingId,
          description: task.description ?? "",
          proposal: task.proposal,
          rows: detail.rows,
        }}
      />
    </section>
  );
}
