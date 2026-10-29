/** Filter keys of the Tasks list (search is counted separately). */
export const TASK_FILTER_KEYS = ["status", "type", "assignee", "overdue"] as const;

export function activeTaskFilters(params: Record<string, string>) {
  return TASK_FILTER_KEYS.filter((k) => params[k]).length;
}
