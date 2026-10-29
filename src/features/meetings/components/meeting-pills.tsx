import { StatusTag, type Tone } from "@/components/ui/badge";
import { MEETING_STATUS_LABELS, type MeetingStatus } from "@/modules/meetings/constants";

/** UI spec: Scheduled = info, Completed = success, Cancelled = danger. */
const TONES: Record<MeetingStatus, Tone> = { scheduled: "sky", completed: "brand", cancelled: "rose" };

export function MeetingStatusPill({ status }: { status: MeetingStatus }) {
  return <StatusTag tone={TONES[status]}>{MEETING_STATUS_LABELS[status]}</StatusTag>;
}
