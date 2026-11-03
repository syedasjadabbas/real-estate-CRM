import { ArrowLeft, Pencil, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { SummaryTile } from "@/components/ui/stat";
import { BookingStagePill } from "@/features/bookings/components/stage-pill";
import { formatArea, formatListedOn, formatPrice } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { RebuildRowsButton, TaskStatusPanel } from "@/features/tasks/components/task-panels";
import { OverdueChip, TaskStatusPill, TaskTypeTag } from "@/features/tasks/components/task-pills";
import { TASK_TYPE_LABELS, type TaskStatus, type TaskType } from "@/modules/tasks/constants";
import { rowsTotal } from "@/modules/tasks/plan";
import { canDoTask } from "@/modules/tasks/policy";
import { getTaskDetail, type TaskDetail } from "@/modules/tasks/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Task" };

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  type: "type",
  dueAt: "due date",
  assigneeId: "assignee",
  leadId: "lead",
  bookingId: "booking",
  description: "description",
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</p>
      <div className="mt-0.5 text-sm font-bold break-words">{children}</div>
    </div>
  );
}

function historyText(h: TaskDetail["history"][number], names: Record<string, string>) {
  const d = (h.data ?? {}) as Record<string, unknown>;
  switch (h.action) {
    case "create":
      return `Created as ${TASK_TYPE_LABELS[d.type as TaskType] ?? "task"}`;
    case "status":
      return `Status: ${d.fromLabel} → ${d.toLabel}`;
    case "assign":
      return `Reassigned: ${names[d.from as string] ?? "—"} → ${names[d.to as string] ?? "—"}`;
    case "update":
      return `Updated ${Object.keys(d).map((k) => FIELD_LABELS[k] ?? k).join(", ")}`;
    case "plan":
      return `Plan saved: ${d.discountPct}% discount, ${d.downPaymentPct}% down, ${d.installmentCount} installments${d.rowsEdited ? " (rows edited)" : ""}`;
    case "rebuild":
      return `Installment rows rebuilt (${d.rows} rows)`;
    default:
      return h.action;
  }
}

export default async function TaskDetailPage({ params, searchParams }: PageProps<"/dashboard/tasks/[id]">) {
  const actor = await requirePageUser();
  if (!canDoTask(actor, "view")) return <RestrictedState />;
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  let detail: TaskDetail;
  try {
    detail = await getTaskDetail(getDb(), actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { task, lead, booking } = detail;
  const p = task.proposal;
  const editable = detail.canEdit && task.status !== "cancelled";

  return (
    <section className="space-y-6" aria-label="Task">
      <PageHeader
        as="h2"
        title={<span className="break-words">{task.title}</span>}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <TaskTypeTag type={task.type} />
            <TaskStatusPill status={task.status as TaskStatus} />
            {detail.overdue ? <OverdueChip /> : null}
          </span>
        }
        actions={
          <>
            <Link href="/dashboard/tasks" className={buttonClasses({ variant: "secondary", size: "lg" })}>
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to list
            </Link>
            {p ? (
              <Link href={`/print/proposal/${task.id}`} target="_blank" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                <Printer aria-hidden="true" className="size-4" />
                Print
              </Link>
            ) : null}
            {editable ? (
              <Link href={`/dashboard/tasks/${task.id}/edit`} className={buttonClasses({ variant: "primary", size: "lg", className: "px-5" })}>
                <Pencil aria-hidden="true" className="size-4" />
                Edit
              </Link>
            ) : null}
          </>
        }
      />
      {saved ? (
        <p role="status" className="rounded-2xl border border-brand/30 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700">
          Task saved.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <PanelCard title="Details">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Assignee">{detail.assigneeName ?? "—"}</Fact>
              <Fact label="Due">
                <span className={detail.overdue ? "text-rose-600" : undefined}>{task.dueAt ? formatDateTime(task.dueAt) : "—"}</span>
              </Fact>
              <Fact label="Created by">{detail.creatorName ?? "—"}</Fact>
              <Fact label="Lead">
                {lead ? (
                  <Link href={`/dashboard/leads/${lead.id}`} className="text-brand hover:underline">
                    {lead.name} ({lead.code})
                  </Link>
                ) : detail.hiddenLead ? (
                  <span className="text-zinc-500">Linked (outside your access)</span>
                ) : (
                  "—"
                )}
              </Fact>
              <Fact label="Booking">
                {booking ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/dashboard/bookings/${booking.id}`} className="text-brand hover:underline">
                      Unit {booking.unitNo} · {booking.projectName}
                    </Link>
                    <BookingStagePill stage={booking.stage} />
                  </span>
                ) : detail.hiddenBooking ? (
                  <span className="text-zinc-500">Linked (outside your access)</span>
                ) : (
                  "—"
                )}
              </Fact>
              <Fact label="Updated">{formatDateTime(task.updatedAt)}</Fact>
            </div>
            <div className="mt-4 border-t border-zinc-100 pt-4">
              <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">Description</p>
              <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-800">{task.description || "No description."}</p>
            </div>
          </PanelCard>

          {p ? (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3.5">
                <div>
                  <h3 className="text-sm leading-5 font-black">Proposal & payment plan</h3>
                  <p className="text-[11px] text-zinc-500">A proposed plan only. Payments are recorded in Finance.</p>
                </div>
                {editable ? <RebuildRowsButton taskId={task.id} /> : null}
              </div>
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Fact label="Customer">{p.customerName}</Fact>
                  <Fact label="Project">{p.printTitle || detail.projectName || "—"}</Fact>
                  <Fact label="Unit">{p.apartmentNo ? `${p.apartmentNo} · ${formatArea(p.areaSqft)}` : "—"}</Fact>
                  <Fact label="Price / sq ft">{formatPrice(p.pricePerSqft)}</Fact>
                  <Fact label="Total sale value (list)">{formatPrice(p.totalList)}</Fact>
                  <Fact label="Expected ROI annually">{p.roiAnnual !== null ? formatPrice(p.roiAnnual) : "—"}</Fact>
                </div>
                {/* One column on phones so amounts are never cut off. */}
                {detail.unitChanged ? (
                  <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                    The unit&apos;s price changed after this proposal was saved (saved {formatPrice(detail.unitChanged.savedPricePerSqft)} / sq ft, now{" "}
                    {formatPrice(detail.unitChanged.currentPricePerSqft)} / sq ft). Open Edit and save to update the figures and schedule.
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryTile label={`After ${p.discountPct}% discount`} value={formatPrice(p.afterDiscount)} />
                  <SummaryTile label={`Down payment ${p.downPaymentPct}%`} value={formatPrice(p.downPayment)} />
                  <SummaryTile label="Each installment" value={formatPrice(p.eachInstallment)} />
                  <SummaryTile label="Installments" value={p.installmentCount} />
                </div>
                {detail.rows.length === 0 ? (
                  <EmptyState size="sm">No schedule yet. Pick a unit with a price to generate rows.</EmptyState>
                ) : (
                  <div className="max-h-[420px] overflow-auto rounded-xl border border-zinc-200/80">
                    <table className="w-full min-w-[480px] border-collapse text-left text-xs">
                      <thead className="sticky top-0 bg-zinc-100">
                        <tr className="text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                          <th scope="col" className="px-3 py-2.5">#</th>
                          <th scope="col" className="px-3 py-2.5">Installment</th>
                          <th scope="col" className="px-3 py-2.5">Description</th>
                          <th scope="col" className="px-3 py-2.5">Progress</th>
                          <th scope="col" className="px-3 py-2.5">Due date</th>
                          <th scope="col" className="px-3 py-2.5 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.rows.map((r) => (
                          <tr key={r.seq} className="border-t border-zinc-100">
                            <td className="px-3 py-2 font-bold text-zinc-500 tabular-nums">{r.seq}</td>
                            <td className="px-3 py-2 font-semibold">{r.label}</td>
                            <td className="px-3 py-2 text-zinc-700">{r.description ?? ""}</td>
                            <td className="px-3 py-2 text-zinc-700">{r.progress ?? ""}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-zinc-700 tabular-nums">{r.dueOn ? formatListedOn(r.dueOn) : ""}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatPrice(r.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-zinc-200 bg-zinc-50 font-black">
                          <td colSpan={5} className="px-3 py-2">
                            Total
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatPrice(rowsTotal(detail.rows))}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </Card>
          ) : null}

          <PanelCard title="History">
            {detail.history.length === 0 ? (
              <EmptyState size="sm">No history yet.</EmptyState>
            ) : (
              <ol className="space-y-2">
                {detail.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 pb-2 text-xs last:border-b-0 last:pb-0">
                    <span className="min-w-0 font-semibold text-zinc-800">{historyText(h, detail.userNames)}</span>
                    <span className="text-[11px] text-zinc-500">
                      {h.actorName ?? "System"} · {formatDateTime(h.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </PanelCard>
        </div>
        <div className="min-w-0 space-y-6">
          <TaskStatusPanel taskId={task.id} status={task.status as TaskStatus} canEdit={detail.canEdit} />
          {task.status === "cancelled" ? <p className="text-[11px] text-zinc-500">Cancelled tasks can&apos;t be edited. Set another status to reopen it.</p> : null}
        </div>
      </div>
    </section>
  );
}
