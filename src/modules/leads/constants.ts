/** Pipeline stages in reference order (MODULES_AND_FEATURES.md §2.3). */
export const LEAD_STAGES = [
  "new_lead",
  "contact_attempted",
  "contacted",
  "qualified_lead",
  "meeting_scheduled",
  "meeting_done",
  "booking_in_process",
  "booked",
  "lost_lead",
  "future_opportunity",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const STAGE_LABELS: Record<LeadStage, string> = {
  new_lead: "New Lead",
  contact_attempted: "Contact Attempted",
  contacted: "Contacted",
  qualified_lead: "Qualified Lead",
  meeting_scheduled: "Meeting Scheduled",
  meeting_done: "Meeting Done",
  booking_in_process: "Booking in Process",
  booked: "Booked",
  lost_lead: "Lost Lead",
  future_opportunity: "Future Opportunity",
};

export const OPEN_STAGES: LeadStage[] = LEAD_STAGES.filter((s) => s !== "booked" && s !== "lost_lead");

export const PRIORITIES = ["none", "low", "medium", "high"] as const;
export type LeadPriority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<LeadPriority, string> = {
  none: "Not selected",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const INBOUND_LABELS = { manual: "Manual", meta: "Meta", tiktok: "Tiktok", import: "Import" } as const;

/** Follow-up filter windows from the reference pipeline filters. */
export const FOLLOW_UP_WINDOWS = ["overdue", "1d", "2d", "after2d"] as const;
export type FollowUpWindow = (typeof FOLLOW_UP_WINDOWS)[number];
export const FOLLOW_UP_WINDOW_LABELS: Record<FollowUpWindow, string> = {
  overdue: "Overdue",
  "1d": "Within 1 day",
  "2d": "Within 2 days",
  after2d: "After 2 days",
};

export const LEAD_VIEWS = ["all", "won", "lost", "regenerated", "favorites", "duplicates"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];

export const SORTABLE_COLUMNS = [
  "name",
  "phone",
  "city",
  "owner",
  "createdAt",
  "stage",
  "source",
  "budget",
  "project",
  "priority",
] as const;
export type SortColumn = (typeof SORTABLE_COLUMNS)[number];

export const PAGE_SIZE = 50;

/** Hours after creation with no interaction before a new lead counts as "unattended". */
export const UNATTENDED_HOURS = 24;

/** Business time zone for day-based buckets (To-dos). */
export const BUSINESS_TIME_ZONE = "Asia/Karachi";
