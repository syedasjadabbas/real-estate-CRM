import { ArrowLeft } from "lucide-react";
import { FreshForm } from "@/components/ui/fresh-form";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { TaskForm } from "@/features/tasks/components/task-form";
import { businessToday } from "@/modules/bookings/today";
import { PRINTABLE_TASK_TYPES, type TaskType } from "@/modules/tasks/constants";
import { canDoTask } from "@/modules/tasks/policy";
import { taskFormOptions } from "@/modules/tasks/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getProjectScope } from "@/server/project-scope";

export const metadata: Metadata = { title: "Create task" };

export default async function NewTaskPage({ searchParams }: PageProps<"/dashboard/tasks/new">) {
  const actor = await requirePageUser();
  if (!canDoTask(actor, "create")) return <RestrictedState />;
  const [{ lead, booking, type }, { activeProjectId }] = await Promise.all([searchParams, getProjectScope()]);
  const leadId = typeof lead === "string" ? lead : "";
  const bookingId = typeof booking === "string" ? booking : "";
  const options = await taskFormOptions(getDb(), actor, activeProjectId, { leadId, bookingId });

  return (
    <section className="space-y-6" aria-label="Create task">
      <PageHeader
        as="h2"
        title="Create task"
        description="Assign work, link a lead or booking, and optionally attach a printable plan."
        actions={
          <Link href="/dashboard/tasks" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to list
          </Link>
        }
      />
      <FreshForm>
        <TaskForm
          mode="create"
          options={options}
          today={businessToday()}
          initial={{
            title: "",
            type: (PRINTABLE_TASK_TYPES as readonly string[]).includes(String(type)) ? (type as TaskType) : "proposal",
            dueLocal: "",
            assigneeId: actor.id,
            leadId: options.leads.some((l) => l.id === leadId) ? leadId : "",
            bookingId: options.bookings.some((b) => b.id === bookingId) ? bookingId : "",
            description: "",
            proposal: null,
            rows: [],
          }}
        />
      </FreshForm>
    </section>
  );
}
