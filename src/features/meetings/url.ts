/** Filter keys of the Meetings list (search is counted separately). */
export const MEETING_FILTER_KEYS = ["status", "organizer", "overdue"] as const;

export function activeMeetingFilters(params: Record<string, string>) {
  return MEETING_FILTER_KEYS.filter((k) => params[k]).length;
}
