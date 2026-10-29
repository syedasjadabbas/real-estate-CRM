import { StatusTag, type Tone } from "@/components/ui/badge";
import { TASK_STATUS_LABELS, TASK_TYPE_LABELS, type TaskStatus, type TaskType } from "@/modules/tasks/constants";

/** UI spec: Open = info, In progress = warning, Done = success, Cancelled = danger. */
const STATUS_TONES: Record<TaskStatus, Tone> = { open: "sky", in_progress: "amber", done: "brand", cancelled: "rose" };

export function TaskStatusPill({ status }: { status: TaskStatus }) {
  return <StatusTag tone={STATUS_TONES[status]}>{TASK_STATUS_LABELS[status]}</StatusTag>;
}

export function TaskTypeTag({ type }: { type: TaskType }) {
  return <StatusTag tone={type === "general" ? "neutral" : "brand"}>{TASK_TYPE_LABELS[type]}</StatusTag>;
}

export function OverdueChip() {
  return (
    <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-black tracking-[0.05em] whitespace-nowrap text-rose-700 uppercase">
      Overdue
    </span>
  );
}
