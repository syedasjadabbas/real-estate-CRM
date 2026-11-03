import { StatusTag } from "@/components/ui/badge";
import { LEAVE_STATUS_LABELS, type LeaveStatus } from "@/modules/leave/rules";

const TONE: Record<LeaveStatus, "brand" | "amber" | "rose" | "neutral" | "sky"> = {
  pending: "amber",
  approved: "brand",
  rejected: "rose",
  withdrawn: "neutral",
  cancel_requested: "sky",
  cancelled: "neutral",
};

export function LeaveStatusTag({ status }: { status: LeaveStatus }) {
  return <StatusTag tone={TONE[status]}>{LEAVE_STATUS_LABELS[status]}</StatusTag>;
}
