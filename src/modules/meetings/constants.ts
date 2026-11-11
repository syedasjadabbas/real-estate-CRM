import type { LeadStage } from "@/modules/leads/constants";

/** FR-100 statuses, in the reference's order and wording. Completed and cancelled are final. */
export const MEETING_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * Forward-only lead moves (decisions D1 / D2, 29 Oct 2026). A lead is moved only from these stages;
 * Future Opportunity, Lost, Booking in Process and Booked are never moved by a meeting.
 */
export const SCHEDULE_MOVES_FROM: LeadStage[] = ["new_lead", "contact_attempted", "contacted", "qualified_lead"];
export const COMPLETE_MOVES_FROM: LeadStage[] = [...SCHEDULE_MOVES_FROM, "meeting_scheduled"];

/** Where or how the meeting takes place (client request, 11 Nov 2026). */
export const MEETING_TYPES = ["company_office", "site_visit", "virtual", "outdoor", "sales_event"] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  company_office: "Company office",
  site_visit: "Site visit",
  virtual: "Virtual",
  outdoor: "Outdoor",
  sales_event: "Sales event",
};

export const MEETING_SORT_COLUMNS = ["title", "startsAt", "organizer", "lead", "status", "updatedAt"] as const;
export type MeetingSortColumn = (typeof MEETING_SORT_COLUMNS)[number];

export const MEETING_PAGE_SIZE = 50;

/** Whether a meeting step would move the lead from `stage` (shown on the form before saving). */
export function wouldMoveLead(step: "schedule" | "complete", stage: LeadStage) {
  return (step === "schedule" ? SCHEDULE_MOVES_FROM : COMPLETE_MOVES_FROM).includes(stage);
}
